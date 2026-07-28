"use client"

import { normalizeTicker, buildMetadataURI } from "@/lib/metadata"

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
import { CONTRACTS, arc } from "@/lib/chain"
import { useSaltMiner } from "@/lib/use-salt-miner"

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
 * The curve preset every launch uses. deploy() takes it as a second argument —
 * the factory now carries a MENU of owner-curated curves rather than one fixed
 * pair of ticks, and preset 0 is the shipped one (opens ~$8,618, graduates at
 * $8,787) -- read live from the deployed factory, not assumed.
 *
 * This argument did not exist on the Robinhood v1.1 deployment, and the app's
 * hand-pinned ABI hid that: `deploy(config)` type-checked against the stale ABI
 * and would have encoded a selector the deployed factory does not have. If a
 * second preset is ever added, this becomes a user choice rather than a
 * constant.
 */
const CURVE_CONFIG_ID = 0n

/**
 * devBuyMinOut is a slippage floor, and 0 is safe here — deliberately, not
 * lazily. deploy() creates the pool in the same transaction at a price this
 * same call chose, so the fill is fully deterministic: there is no other trade
 * that can land first and no race to be sandwiched by. Hence no slippage UI.
 */
const DEV_BUY_MIN_OUT = 0n

/**
 * USDC cost of the dev-buy cap -- DISPLAY ONLY. Enforcement is the on-chain
 * simulation in useLaunch(); this number never gates a signature by itself.
 *
 * The cap is enforced on SUPPLY (2% of 100B), not on USDC, so there is no exact
 * figure in the contract to read. It follows from the curve:
 *   cost(f) = openingMcap * f/(1-f) = 8618.38 * 0.02/0.98 = 175.89 USDC
 * so the displayed 100 sits comfortably under the on-chain 2% cap.
 *
 * ⚠️ These figures are outputs of curve preset 0, which the factory admin (the
 * contract developer, not us) can rewrite at any time via updateCurveConfig.
 * They are the expected reading today, not constants of the system. If the
 * displayed numbers ever disagree with a launch, re-read getCurveConfig(0)
 * before assuming a UI bug.
 */
export const DEV_BUY_CAP_USDC = 100

// Pure, node-testable metadata builders live in lib/metadata.ts (this file is
// "use client"). Re-exported so callers import them from one place.
export { normalizeTicker, buildMetadataURI } from "@/lib/metadata"

/**
 * The dev-buy input only filters characters, so it still admits "1.2.3" and
 * ".". parseEther throws on those — never let that reach a render.
 */
export function parseUsdcInput(raw: string): bigint | undefined {
  const s = raw.trim()
  if (s === "") return 0n
  if (!/^\d*\.?\d*$/.test(s) || s === ".") return undefined
  try {
    return parseEther(s)
  } catch {
    return undefined
  }
}


export function buildConfig(
  name: string,
  ticker: string,
  lore = "",
  emoji = "🚢",
  imageUri?: string,
  links?: { twitter?: string; telegram?: string; website?: string }
): LaunchConfig {
  return {
    name: name.trim(),
    symbol: normalizeTicker(ticker),
    // imageUri (an ipfs://CID) becomes part of metadataURI, so it feeds the
    // CREATE2 initcode hash and therefore the salt: change the image and the
    // mined address changes with it. The wizard must finish the upload before
    // mining, which the mining effect's initCodeHash dependency already enforces.
    metadataURI: buildMetadataURI(name, ticker, lore, emoji, imageUri, links),
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
      return `Over the cap — max dev-buy is ${DEV_BUY_CAP_USDC} USDC (~${capPct}% of supply). The launch would revert on-chain; we won't let you pay gas to fail.`
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
        return "Not enough USDC in this wallet to cover the dev-buy plus gas."
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
  capUsdc: number
  /** Real predictTokenAddress() read — the address that will be deployed. */
  predicted?: Address
  /** predictTokenAddress() returned address(0): no salt worked for this config. */
  predictFailed: boolean
  /** Vanity mining: the factory rejects any address not ending 8787. */
  mining: boolean
  /** Hashes attempted, for an indeterminate readout. Completion is probabilistic. */
  miningAttempts: number
  /** 0-1 by candidates FOUND, never an extrapolated percentage. */
  miningProgress: number
  /** Mining failed outright — a config error, not bad luck. */
  miningError?: string
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
  capUsdc: DEV_BUY_CAP_USDC,
  predictFailed: false,
  mining: false,
  miningAttempts: 0,
  miningProgress: 0,
  predictPending: false,
  retryPredict: () => {},
  ready: false,
  checking: false,
  launch: () => {},
  status: "idle",
  reset: () => {},
}

export type CurvePreset = {
  /** curveConfigId to pass to deploy/predict. */
  id: bigint
  /** Fee tier in hundredths of a bip: 10000 = 1%, 3000 = 0.3%, 500 = 0.05%. */
  feeBps: number
  /** Display label, "1%" / "0.3%" / "0.05%". */
  label: string
  /** Graduation threshold in USDC for this preset. */
  graduationUsdc: number
}

/**
 * The live fee-tier menu, read from the factory's curve presets. The economics
 * are owner-configurable and presets can be toggled, so we READ them (never
 * hardcode): each enabled preset carries its own fee tier since v1.7.
 * Shipped today: 0 → 1%, 1 → 0.3%, 2 → 0.05%.
 *
 * Reads a fixed 0/1/2 (the deployed count) so the hook order is stable; a preset
 * is shown only when it exists (id < count) and is enabled.
 */
export function useCurvePresets(): { presets: CurvePreset[]; loading: boolean } {
  /* eslint-disable react-hooks/rules-of-hooks */
  const count = useReadContract({
    address: CONTRACTS.launchFactory,
    abi: LaunchFactoryAbi,
    functionName: "curveConfigCount",
    chainId: arc.id,
  })
  const n = count.data
  const reads = [0n, 1n, 2n].map((id) =>
    useReadContract({
      address: CONTRACTS.launchFactory,
      abi: LaunchFactoryAbi,
      functionName: "getCurveConfig",
      args: [id],
      chainId: arc.id,
      query: { enabled: n === undefined || id < n },
    })
  )
  /* eslint-enable react-hooks/rules-of-hooks */

  const presets: CurvePreset[] = reads
    .map((r, i) => ({ cfg: r.data, id: BigInt(i) }))
    .filter((x): x is { cfg: NonNullable<typeof x.cfg>; id: bigint } => !!x.cfg && x.cfg.enabled)
    .map(({ cfg, id }) => {
      const feeBps = Number(cfg.fee)
      return {
        id,
        feeBps,
        label: `${feeBps / 10000}%`,
        graduationUsdc: Number(cfg.graduationThreshold) / 1e6,
      }
    })

  return { presets, loading: count.isLoading || reads.some((r) => r.isLoading) }
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
  active: boolean,
  /** Which curve preset (fee tier) to launch against. 0 = 1% (the shipped
   *  default); 1 = 0.3%; 2 = 0.05%. The predict + deploy MUST use the same id or
   *  the pool-free check (tier-aware since v1.7) is answered for the wrong tier. */
  curveConfigId: bigint = CURVE_CONFIG_ID
): Launch {
  if (!PRIVY_CONFIGURED) return IDLE

  /* eslint-disable react-hooks/rules-of-hooks */
  const { address, chainId } = useAccount()

  // Cheap, instant, and answers the most common failure before the simulation
  // round-trips: the wallet simply cannot pay. The sim is still the authority —
  // this exists so the UI can say WHY rather than dying quietly.
  const { data: balance } = useBalance({ address, chainId: arc.id })

  const { data: capBps } = useReadContract({
    address: CONTRACTS.launchFactory,
    abi: LaunchFactoryAbi,
    functionName: "maxDevBuyBps",
    chainId: arc.id,
  })

  // Right chain, funded, papers filled in. Anything less and the reads below
  // are noise.
  const onChain = chainId === arc.id
  const canRead = active && !!config && !!address && onChain

  // The token's init code hash for THIS exact config. name, symbol and
  // metadataURI are constructor args, so it moves with every edit — read it
  // live rather than pinning, since it also tracks the token bytecode and
  // compiler settings.
  const initCodeHash = useReadContract({
    address: CONTRACTS.launchFactory,
    abi: LaunchFactoryAbi,
    functionName: "tokenInitCodeHash",
    args: config ? [config] : undefined,
    chainId: arc.id,
    query: { enabled: canRead },
  })

  const miner = useSaltMiner()

  // Mine when (and only when) the inputs that determine the address are all
  // known. The dependency list IS the invalidation rule: a new config yields a
  // new initCodeHash, a wallet switch a new deployer, and either restarts the
  // grind. Without that, the wizard could show an address the coin never lands
  // on -- the one failure this whole path exists to prevent.
  const hash_ = initCodeHash.data
  const mine = miner.mine
  const resetMiner = miner.reset
  React.useEffect(() => {
    if (!canRead || !address || !hash_) {
      resetMiner()
      return
    }
    mine(CONTRACTS.launchFactory, address, hash_)
  }, [canRead, address, hash_, mine, resetMiner])

  const salts = miner.salts.map((s) => s.salt)

  // Confirm against the factory rather than trusting our own maths: it returns
  // suffixOk and poolFree too, so a squatted candidate is visible before signing.
  const predict = useReadContract({
    address: CONTRACTS.launchFactory,
    abi: LaunchFactoryAbi,
    functionName: "predictTokenAddress",
    // v1.4 added the curveConfigId arg (the pool-free check is per fee tier).
    // The predicted ADDRESS is independent of it — but the arity must match or
    // the call reverts to encode.
    args: address && config && salts[0] ? [address, config, salts[0], curveConfigId] : undefined,
    chainId: arc.id,
    query: { enabled: canRead && salts.length > 0 },
  })

  // v1.4 charges a flat launch fee taken off msg.value; the remainder is the
  // dev-buy (contract: `devBuyNative = msg.value - launchFee`). Read live so a
  // fee change needs no code change; fall back to the deployed 1 USDC so a
  // pending read never sends a value the factory would reject.
  const { data: launchFeeData } = useReadContract({
    address: CONTRACTS.launchFactory,
    abi: LaunchFactoryAbi,
    functionName: "launchFee",
    chainId: arc.id,
  })
  const feeWei = launchFeeData ?? 1_000_000_000_000_000_000n
  const totalValueWei = valueWei !== undefined ? valueWei + feeWei : undefined

  const sim = useSimulateContract({
    address: CONTRACTS.launchFactory,
    abi: LaunchFactoryAbi,
    functionName: "deploy",
    args: config && salts.length > 0 ? [config, curveConfigId, salts] : undefined,
    value: totalValueWei,
    chainId: arc.id,
    query: { enabled: canRead && totalValueWei !== undefined && salts.length > 0 },
  })

  const { writeContract, data: hash, isPending, error: writeError, reset } = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash, chainId: arc.id })

  const token = React.useMemo(
    () => (receipt.data ? tokenFromReceipt(receipt.data) : undefined),
    [receipt.data]
  )
  /* eslint-enable react-hooks/rules-of-hooks */

  // address(0) means no salt in 256 tries produced a token that sorts against
  // WRAPPED_NATIVE. The salt is keccak(deployer, nonce, i) — deterministic — so re-reading
  // the SAME config returns the SAME zero. Only a different initcode (name /
  // ticker) or a moved nonce changes the answer. Never present this as "retry".
  const predicted = predict.data?.[0]
  const predictFailed = predicted === "0x0000000000000000000000000000000000000000"

  const capPct = capBps !== undefined ? capBps / 100 : 2

  // Gas headroom for the deploy itself (~0.00045 USDC measured on the shipped
  // curve). Deliberately generous: telling someone they're short when they are
  // not is worse than letting the simulation catch the edge.
  const GAS_HEADROOM_WEI = 700_000_000_000_000n // 0.0007
  // Balance must cover the launch fee + dev-buy + gas.
  const needWei = totalValueWei !== undefined ? totalValueWei + GAS_HEADROOM_WEI : undefined
  const short =
    balance !== undefined && needWei !== undefined && balance.value < needWei

  let blocked: string | undefined
  if (valueWei === undefined) blocked = "That dev-buy isn't a number."
  else if (short)
    blocked =
      `Not enough USDC in this wallet. You have ${Number(formatEther(balance!.value)).toFixed(5)} USDC; ` +
      `this needs about ${Number(formatEther(needWei!)).toFixed(5)} USDC (launch fee + dev-buy + gas). ` +
      `Lower the dev-buy or top the wallet up.`
  // Mining failures are a config error, not bad luck: the miner only gives up
  // after 2M attempts, ~30 sigma past the 1-in-65,536 odds.
  else if (miner.error) blocked = `Couldn't mine a berth number: ${miner.error}`
  else if (predictFailed)
    blocked = "The shipyard couldn't find a berth for this name. Nudge the name or ticker and try again."
  // Every candidate's pool is taken. Re-mining gives a fresh set; the factory
  // only skips OCCUPIED candidates, so this is recoverable.
  else if (predict.data && predict.data[2] === false)
    blocked = "Another ship took that berth. Re-mining a new one…"
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
    capUsdc: DEV_BUY_CAP_USDC,
    predicted: predictFailed ? undefined : predicted,
    predictFailed,
    mining: miner.status === "mining",
    miningAttempts: miner.attempts,
    miningProgress: miner.progress,
    miningError: miner.error,
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
