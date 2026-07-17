"use client"

import * as React from "react"
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeEventLog,
  parseEther,
  type Address,
  formatEther,
  type Hash,
  type TransactionReceipt,
} from "viem"
import {
  useAccount,
  useBalance,
  useReadContract,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi"

import { PRIVY_CONFIGURED } from "@/components/providers"
import { LaunchFactoryAbi } from "@/lib/abis"
import { CONTRACTS, robinhood } from "@/lib/chain"

/**
 * LaunchFactory.LaunchConfig. The caller supplies cosmetics only — supply is
 * fixed at 100B in the contract, and the ticks + fee split come from owner-set
 * state, not from us.
 */
export type LaunchConfig = {
  name: string
  symbol: string
  metadataURI: string
  devBuyMinOut: bigint
}

/**
 * TODO: there is no metadata upload pipeline yet, so every launch ships this
 * placeholder. Replace with the real ipfs:// (or https://) URI once uploads
 * exist — the wizard's lore + emoji are NOT persisted anywhere until then.
 *
 * Do not vary this per-launch casually: metadataURI is an ERC20 constructor
 * arg, so it feeds the CREATE2 initcode hash. predictTokenAddress() and
 * deploy() must be handed the byte-identical config or the address we show is
 * not the address that gets deployed.
 */
export const METADATA_URI_PLACEHOLDER = "ipfs://berth-placeholder"

/**
 * devBuyMinOut is a slippage floor, and 0 is safe here — deliberately, not
 * lazily. deploy() creates the pool in the same transaction at a price this
 * same call chose, so the fill is fully deterministic: there is no other trade
 * that can land first and no race to be sandwiched by. Hence no slippage UI.
 */
const DEV_BUY_MIN_OUT = 0n

/**
 * ETH cost of the dev-buy cap — DISPLAY ONLY. Enforcement is the on-chain
 * simulation in useLaunch(); this number never gates a signature by itself.
 *
 * The cap is enforced on SUPPLY (bps of 100B), not on ETH, so there is no
 * exact ETH figure in the contract to read. Every launch opens on the same
 * owner-set curve though, so the ETH boundary is the same constant for all of
 * them. Measured against the live factory by bisecting deploy():
 *   0.004459884166717529 Ξ passes, 0.004459884762763976 Ξ reverts.
 * Floored to 0.00445 so the number we advertise is always actually payable.
 *
 * NOTE: the spec's "0.0045" is ABOVE the true boundary — it reverts on-chain
 * (verified: DevBuyExceedsCap / 0xefe14648). Do not restore it.
 *
 * ponytail: a hardcoded curve constant, correct while the owner leaves ticks
 * and maxDevBuyBps alone. If setTicks() / setMaxDevBuyBps() ever move, this
 * display drifts but nobody pays gas to fail — the simulation still blocks.
 */
export const DEV_BUY_CAP_ETH = 0.00445

/** Ticker rule: uppercase A-Z0-9, max 8. */
export function normalizeTicker(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)
}

/**
 * The dev-buy input only filters characters, so it still admits "1.2.3" and
 * ".". parseEther throws on those — never let that reach a render.
 */
export function parseEthInput(raw: string): bigint | undefined {
  const s = raw.trim()
  if (s === "") return 0n
  if (!/^\d*\.?\d*$/.test(s) || s === ".") return undefined
  try {
    return parseEther(s)
  } catch {
    return undefined
  }
}

/**
 * Build the metadata URI.
 *
 * There is no upload pipeline yet, and a bare placeholder threw away the lore
 * and face the creator picked. So we inline the metadata as a data: URI — it is
 * self-contained, needs no host, and makes the creator's choices actually
 * survive the launch (the indexer reads them straight back out of the event).
 *
 * `image` is a deterministic placeholder derived from the ticker; swap it for a
 * real upload (ipfs://…) when that lands — nothing else here needs to change.
 *
 * MUST be deterministic: metadataURI is a constructor arg, so it feeds the
 * CREATE2 initcode hash. Predict and deploy have to see byte-identical input or
 * the previewed address is a lie. Key order is fixed for that reason.
 */
export function buildMetadataURI(name: string, ticker: string, lore: string, emoji: string): string {
  const symbol = normalizeTicker(ticker)
  const meta = {
    name: name.trim(),
    symbol,
    description: lore.trim(),
    emoji,
    image: `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(symbol || "berth")}`,
  }
  // Not base64: plain JSON keeps it readable on the explorer and in the event.
  return `data:application/json,${encodeURIComponent(JSON.stringify(meta))}`
}

export function buildConfig(
  name: string,
  ticker: string,
  lore = "",
  emoji = "🚢"
): LaunchConfig {
  return {
    name: name.trim(),
    symbol: normalizeTicker(ticker),
    metadataURI: buildMetadataURI(name, ticker, lore, emoji),
    devBuyMinOut: DEV_BUY_MIN_OUT,
  }
}

/**
 * Pull the real token address out of the receipt.
 *
 * Filtered to logs emitted BY the factory: the launched token and its pool are
 * untrusted code in this same receipt, and either could emit a lookalike
 * TokenLaunched to point us at an address the user never deployed.
 */
export function tokenFromReceipt(receipt: TransactionReceipt): Address | undefined {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CONTRACTS.launchFactory.toLowerCase()) continue
    try {
      const ev = decodeEventLog({
        abi: LaunchFactoryAbi,
        data: log.data,
        topics: log.topics,
      })
      if (ev.eventName === "TokenLaunched") return ev.args.token
    } catch {
      // not one of ours / not decodable against this ABI — keep looking
    }
  }
  return undefined
}

/** Name of the custom error a revert carried, if it carried one. */
function revertName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError)
  return revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined
}

function shortMessage(err: unknown): string {
  return err instanceof BaseError ? err.shortMessage : String(err)
}

/**
 * Turn a failed deploy simulation into something a captain can act on. The
 * simulation runs the real deploy path, so it catches the cap, the pause, the
 * whitelist and a thin wallet — not just the case we thought to check for.
 */
function blockReason(err: unknown, capPct: number): string {
  switch (revertName(err)) {
    case "DevBuyExceedsCap":
      return `Over the cap — max dev-buy is ${DEV_BUY_CAP_ETH} Ξ (~${capPct}% of supply). The launch would revert on-chain; we won't let you pay gas to fail.`
    case "SaltMiningFailed":
      return "The shipyard couldn't find a berth for this name. Nudge the name or ticker and try again."
    case "NotWhitelisted":
      return "The shipyard is whitelist-only right now and this wallet isn't on the list."
    case "EnforcedPause":
      return "The shipyard is paused. Nothing leaves the yard until it reopens."
    case "PoolAlreadyExists":
      return "A pool for this coin already exists. Nudge the name or ticker and try again."
    default: {
      const msg = shortMessage(err)
      if (/insufficient funds/i.test(msg)) {
        return "Not enough Ξ in this wallet to cover the dev-buy plus gas."
      }
      return `This launch would revert on-chain, so we won't let you pay gas to fail. ${msg}`
    }
  }
}

export type LaunchStatus = "idle" | "signing" | "mining" | "done" | "error"

export type Launch = {
  /** Live maxDevBuyBps() — 200 on the shipped factory. */
  capBps?: number
  /** The same, as a percent of supply, for display. */
  capPct: number
  capEth: number
  /** Real predictTokenAddress() read — the address that will be deployed. */
  predicted?: Address
  /** predictTokenAddress() returned address(0): no salt worked for this config. */
  predictFailed: boolean
  predictPending: boolean
  retryPredict: () => void
  /** Why we refuse to let them sign, if we do. */
  blocked?: string
  /** Simulation in flight — the button is dead but for a reason worth naming. */
  checking: boolean
  /** Simulation passed — signing this is safe. */
  ready: boolean
  launch: () => void
  status: LaunchStatus
  /** Real token address, parsed from the TokenLaunched log. */
  token?: Address
  hash?: Hash
  error?: string
  reset: () => void
}

const IDLE: Launch = {
  capPct: 2,
  capEth: DEV_BUY_CAP_ETH,
  predictFailed: false,
  predictPending: false,
  retryPredict: () => {},
  ready: false,
  checking: false,
  launch: () => {},
  status: "idle",
  reset: () => {},
}

/**
 * Everything the wizard needs to launch for real.
 *
 * @param config  cosmetics; undefined until the papers are filled in
 * @param valueWei dev-buy, funds the creator's atomic first buy (payable)
 * @param active  gate the reads/simulation to the step that needs them — the
 *                simulation is a full deploy eth_call, not a cheap view
 *
 * PRIVY_CONFIGURED is a build-time constant (same branch as useWallet), so the
 * hook order below is fixed for the app's lifetime.
 */
export function useLaunch(
  config: LaunchConfig | undefined,
  valueWei: bigint | undefined,
  active: boolean
): Launch {
  if (!PRIVY_CONFIGURED) return IDLE

  /* eslint-disable react-hooks/rules-of-hooks */
  const { address, chainId } = useAccount()

  // Cheap, instant, and answers the most common failure before the simulation
  // round-trips: the wallet simply cannot pay. The sim is still the authority —
  // this exists so the UI can say WHY rather than dying quietly.
  const { data: balance } = useBalance({ address, chainId: robinhood.id })

  const { data: capBps } = useReadContract({
    address: CONTRACTS.launchFactory,
    abi: LaunchFactoryAbi,
    functionName: "maxDevBuyBps",
    chainId: robinhood.id,
  })

  // Right chain, funded, papers filled in. Anything less and the reads below
  // are noise.
  const onChain = chainId === robinhood.id
  const canRead = active && !!config && !!address && onChain

  const predict = useReadContract({
    address: CONTRACTS.launchFactory,
    abi: LaunchFactoryAbi,
    functionName: "predictTokenAddress",
    args: address && config ? [address, config] : undefined,
    chainId: robinhood.id,
    query: { enabled: canRead },
  })

  const sim = useSimulateContract({
    address: CONTRACTS.launchFactory,
    abi: LaunchFactoryAbi,
    functionName: "deploy",
    args: config ? [config] : undefined,
    value: valueWei,
    chainId: robinhood.id,
    query: { enabled: canRead && valueWei !== undefined },
  })

  const { writeContract, data: hash, isPending, error: writeError, reset } = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash, chainId: robinhood.id })

  const token = React.useMemo(
    () => (receipt.data ? tokenFromReceipt(receipt.data) : undefined),
    [receipt.data]
  )
  /* eslint-enable react-hooks/rules-of-hooks */

  // address(0) means no salt in 256 tries produced a token that sorts against
  // WETH9. The salt is keccak(deployer, nonce, i) — deterministic — so re-reading
  // the SAME config returns the SAME zero. Only a different initcode (name /
  // ticker) or a moved nonce changes the answer. Never present this as "retry".
  const predicted = predict.data?.[0]
  const predictFailed = predicted === "0x0000000000000000000000000000000000000000"

  const capPct = capBps !== undefined ? capBps / 100 : 2

  // Gas headroom for the deploy itself (~0.00045 Ξ measured on the shipped
  // curve). Deliberately generous: telling someone they're short when they are
  // not is worse than letting the simulation catch the edge.
  const GAS_HEADROOM_WEI = 700_000_000_000_000n // 0.0007
  const needWei = valueWei !== undefined ? valueWei + GAS_HEADROOM_WEI : undefined
  const short =
    balance !== undefined && needWei !== undefined && balance.value < needWei

  let blocked: string | undefined
  if (valueWei === undefined) blocked = "That dev-buy isn't a number."
  else if (short)
    blocked =
      `Not enough Ξ in this wallet. You have ${Number(formatEther(balance!.value)).toFixed(5)} Ξ; ` +
      `this needs about ${Number(formatEther(needWei!)).toFixed(5)} Ξ (dev-buy + gas). ` +
      `Lower the dev-buy or top the wallet up.`
  else if (predictFailed)
    blocked = "The shipyard couldn't find a berth for this name. Nudge the name or ticker and try again."
  else if (sim.error) blocked = blockReason(sim.error, capPct)

  let status: LaunchStatus = "idle"
  if (writeError || receipt.isError) status = "error"
  else if (token || receipt.isSuccess) status = "done"
  else if (hash) status = "mining"
  else if (isPending) status = "signing"

  const error = writeError
    ? // The user waving off their own wallet prompt is not an error worth shouting about.
      /user rejected|denied/i.test(shortMessage(writeError))
      ? "Signature waved off."
      : shortMessage(writeError)
    : receipt.isError
      ? "The launch transaction failed on-chain."
      : undefined

  return {
    capBps,
    capPct,
    capEth: DEV_BUY_CAP_ETH,
    predicted: predictFailed ? undefined : predicted,
    predictFailed,
    predictPending: predict.isFetching,
    retryPredict: () => void predict.refetch(),
    blocked,
    checking: sim.isLoading && !blocked,
    // Only ever true off a simulation that actually passed — never off a guess.
    ready: !!sim.data && !blocked,
    launch: () => sim.data && writeContract(sim.data.request),
    status,
    token,
    hash,
    error,
    reset,
  }
}
