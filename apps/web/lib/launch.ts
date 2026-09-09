"use client"

import * as React from "react"
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeEventLog,
  parseEther,
  zeroAddress,
  zeroHash,
  type Address,
  type Hash,
  type Hex,
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

import { CONSTANTS, CONTRACTS, SYSTEM } from "@workspace/contracts"
import { PRIVY_CONFIGURED } from "@/components/providers"
import { LaunchFactoryAbi, QuotePricerAbi, RouterAbi } from "@/lib/abis"
import { arc } from "@/lib/chain"

export { normalizeTicker } from "@/lib/metadata"

/**
 * Launching a coin on contracts v2.
 *
 * Three things changed shape from v1.4 and they are the whole file:
 *
 * 1. **Identity is on-chain, not in a metadata URI.** `logo`, `description` and
 *    `socials` are constructor args the token stores and exposes, so there is
 *    no `data:` URI to build and no `parseMetadata` to read it back.
 * 2. **The launch goes through the ROUTER, not the factory**, because the
 *    creator's first buy rides in the same transaction:
 *    `launchAndBuyWithNative`. `msg.value` is `launchFee + devBuy`.
 * 3. **No address prediction and no vanity requirement.** v2 exposes neither
 *    `predictTokenAddress` nor `tokenInitCodeHash`, and nothing forces a
 *    suffix, so the salt is just a random 32 bytes and the address is known
 *    only from the receipt. The salt-mining worker is gone with them.
 *
 * There is also **no dev-buy cap** — v1.4's `maxDevBuyBps` / `DevBuyExceedsCap`
 * do not exist in v2. The only ceiling on the opening buy is the creator's
 * balance.
 */

/** `Socials` in TokenParams — fixed order, every field required (empty = ""). */
export type Socials = {
  twitter: string
  telegram: string
  discord: string
  website: string
  farcaster: string
}

/** `TokenParams` exactly as the factory and router take it. */
export type TokenParams = {
  name: string
  symbol: string
  logo: string
  description: string
  socials: Socials
  creatorFeeRecipient: Address
  creatorTaxBps: number
  expectedEconomics: Hex
  salt: Hex
}

/**
 * Where a launch's creator fees land. One address, three meanings — and for the
 * two vault modes the choice is permanent: only the current recipient can move
 * it, and neither vault has a function that does.
 */
export type FeeMode = "keep" | "holders" | "burn"

export function feeRecipientFor(mode: FeeMode, wallet?: string): Address {
  if (mode === "holders") return CONTRACTS.holderVault
  if (mode === "burn") return CONTRACTS.burnVault
  // address(0) means "the deployer" to the factory, which is what an empty fee
  // wallet should do — never silently launch fees to a half-typed address.
  const w = wallet?.trim()
  return w && /^0x[0-9a-fA-F]{40}$/.test(w) ? (w as Address) : zeroAddress
}

/** Read a launch's mode back out of its `creatorFeeRecipient`. */
export function feeModeOf(recipient: string): FeeMode {
  const r = recipient.toLowerCase()
  if (r === CONTRACTS.holderVault.toLowerCase()) return "holders"
  if (r === CONTRACTS.burnVault.toLowerCase()) return "burn"
  return "keep"
}

/**
 * Gas to keep back on top of `launchFee + devBuy`, in native wei.
 *
 * MEASURED, not guessed: the live v2 launch 0x7300ce…404e used 2,623,127 gas at
 * 21 Gwei = 0.0551 USDC. Arc's docs put the minimum base fee at 20 Gwei and drop
 * anything below it from the mempool with no receipt, so gas here has a hard
 * floor and cannot trend toward zero the way it can on a quiet L2. 0.08 leaves
 * ~45% headroom over the measurement.
 *
 * Without this the check passed a wallet holding exactly the launch fee and the
 * transaction then failed on gas.
 */
const GAS_HEADROOM_WEI = 80_000_000_000_000_000n

/** The shipped launch config. `launchConfigCount()` may grow; 0 is the default. */
export const LAUNCH_CONFIG_ID = 0n

/** Native USDC — `address(0)`, 18dp. The 6dp ERC20 face is REFUSED as a quote
 *  asset by the contracts (`NativeAliasNotAllowed`), so never pass SYSTEM.usdc. */
export const NATIVE_QUOTE = SYSTEM.native as Address

/**
 * Build `TokenParams`. Empty strings rather than omitted keys: every field is a
 * constructor arg, and the tuple has to encode in full.
 */
export function buildTokenParams(input: {
  name: string
  symbol: string
  /** ipfs://CID of the uploaded art, or "" to launch without a logo. */
  logo?: string
  description?: string
  socials?: Partial<Socials>
  feeMode: FeeMode
  feeWallet?: string
  creatorTaxBps: number
  expectedEconomics?: Hex
  salt: Hex
}): TokenParams {
  return {
    name: input.name.trim(),
    symbol: input.symbol.trim().toUpperCase(),
    logo: input.logo ?? "",
    description: input.description?.trim() ?? "",
    socials: {
      twitter: input.socials?.twitter?.trim() ?? "",
      telegram: input.socials?.telegram?.trim() ?? "",
      discord: input.socials?.discord?.trim() ?? "",
      website: input.socials?.website?.trim() ?? "",
      farcaster: input.socials?.farcaster?.trim() ?? "",
    },
    creatorFeeRecipient: feeRecipientFor(input.feeMode, input.feeWallet),
    creatorTaxBps: Math.round(input.creatorTaxBps),
    expectedEconomics: input.expectedEconomics ?? zeroHash,
    salt: input.salt,
  }
}

/** A fresh CREATE2 salt. Also the retry path for `PoolAlreadyExists`: a new
 *  salt is a new token address, which is a new pool key. */
export function randomSalt(): Hex {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`
}

/**
 * Parse a dev-buy typed in USDC into NATIVE wei (18dp).
 *
 * The input only filters characters, so it still admits "1.2.3" and "." —
 * parseEther throws on those, and that must never reach a render.
 */
export function parseUsdcInput(raw: string): bigint | undefined {
  const v = raw.trim()
  if (!v) return 0n
  try {
    return parseEther(v)
  } catch {
    return undefined
  }
}

/** Pull the launched token out of the receipt.
 *
 *  Filtered to logs emitted BY the factory: the launched token and its pool are
 *  untrusted code in this same receipt, and either could emit a lookalike
 *  TokenLaunched pointing at an address the user never deployed. */
export function tokenFromReceipt(receipt: TransactionReceipt): Address | undefined {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CONTRACTS.launchFactory.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: LaunchFactoryAbi, data: log.data, topics: log.topics })
      if (ev.eventName === "TokenLaunched") return ev.args.token as Address
    } catch {
      // not one of ours / not decodable against this ABI — keep looking
    }
  }
  return undefined
}

/* ── revert translation ───────────────────────────────────────────── */

function revertName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError)
  return revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined
}

function shortMessage(err: unknown): string {
  return err instanceof BaseError ? err.shortMessage : String(err)
}

/**
 * Turn a failed simulation into something a captain can act on. The simulation
 * runs the real launch path, so it catches the whitelist, the pause, a refused
 * quote asset and a thin wallet — not just the cases we thought to check.
 */
function blockReason(err: unknown): string {
  switch (revertName(err)) {
    case "NotWhitelisted":
      return "Launching is whitelist-only right now and this wallet isn't on the list."
    case "LaunchConfigDisabled":
      return "That launch preset is switched off. Nothing can launch against it."
    case "CreatorTaxTooHigh":
    case "CombinedFeeTooHigh":
      return "That creator tax is above the cap. Bring it down and try again."
    case "PoolAlreadyExists":
      return "A pool for this coin already exists. Retrying picks a new address."
    case "LaunchEconomicsMismatch":
      return "The quote asset's price moved while you were signing. Try again."
    case "NativeAliasNotAllowed":
      return "That address is the ERC20 face of USDC and can't be a quote asset. Pick USDC (native) instead."
    case "PairTokenValidationFailed":
    case "PairTokenEconomicsInvalid":
      return "That token can't be a quote asset — it has no deep enough reference pool."
    case "PairTokenDecimalsUnavailable":
    case "PairTokenDecimalsMismatch":
      return "That token doesn't report decimals the way the pricer needs."
    case "LaunchFeeNotPaid":
      return "The launch fee didn't go through. Check the wallet balance and try again."
    case "InvalidTokenParams":
      return "The name or ticker isn't something the contract will take. Nudge it and try again."
    default: {
      const msg = shortMessage(err)
      if (/insufficient funds/i.test(msg)) {
        return "Not enough USDC in this wallet to cover the launch fee, the dev-buy and gas."
      }
      return `This launch would revert on-chain, so we won't let you pay gas to fail. ${msg}`
    }
  }
}

/* ── terms: what the form needs before it can render honestly ─────── */

export type LaunchTerms = {
  /** Native wei. Falls back to the shipped 0.1 USDC while the read is pending,
   *  so we never send a value the factory would reject. */
  launchFee: bigint
  /** Base pool fee in bps — 100 (1%) on the shipped deployment. */
  baseFeeBps: number
  /** Ceiling on the creator-tax slider — 1000 (10%) as shipped. */
  maxCreatorTaxBps: number
  /** false = this wallet can't launch (whitelist on, or launching disabled). */
  canLaunch: boolean
  /** Opening fully-diluted valuation, in native wei. `phantomQuote`. */
  phantomQuote: bigint
}

export function useLaunchTerms(): LaunchTerms {
  const { address, chainId } = useAccount()
  const on = chainId === arc.id
  const base = { address: CONTRACTS.launchFactory, abi: LaunchFactoryAbi, chainId: arc.id } as const

  const fee = useReadContract({ ...base, functionName: "launchFee" })
  const baseBps = useReadContract({ ...base, functionName: "baseFeeBps" })
  const maxTax = useReadContract({ ...base, functionName: "maxCreatorTaxBps" })
  const config = useReadContract({ ...base, functionName: "getLaunchConfig", args: [LAUNCH_CONFIG_ID] })
  const can = useReadContract({
    ...base,
    functionName: "canLaunch",
    args: address ? [address] : undefined,
    query: { enabled: !!address && on },
  })

  return {
    launchFee: fee.data ?? CONSTANTS.launchFeeNative,
    baseFeeBps: baseBps.data !== undefined ? Number(baseBps.data) : 100,
    maxCreatorTaxBps: maxTax.data !== undefined ? Number(maxTax.data) : 1000,
    // Optimistic until the read lands: a disabled button with no reason is
    // worse than one the simulation later explains.
    canLaunch: can.data ?? true,
    phantomQuote: config.data?.phantomQuote ?? CONSTANTS.phantomQuoteNative,
  }
}

/* ── quote asset: can this thing be paired against, and at what price ─ */

export type QuoteAsset = {
  /** undefined = still reading. */
  priceable?: boolean
  /** Opening FDV in the quote's OWN units, from previewQuoteEconomics. */
  phantomQuote?: bigint
  /**
   * Digest to pin into `expectedEconomics`, or `bytes32(0)` to waive the check.
   *
   * Pinned ONLY for the native quote. For an actively traded ERC-20 the digest
   * is computed off a spot price, so one pinned a block earlier reverts with
   * `LaunchEconomicsMismatch` the moment the reference pool trades.
   */
  expectedEconomics: Hex
}

export function useQuoteAsset(pairToken: Address | undefined): QuoteAsset {
  const enabled = !!pairToken
  const isNative = pairToken === NATIVE_QUOTE

  const priceable = useReadContract({
    address: CONTRACTS.quotePricer,
    abi: QuotePricerAbi,
    functionName: "isPriceable",
    args: pairToken ? [pairToken] : undefined,
    chainId: arc.id,
    query: { enabled: enabled && !isNative },
  })

  const economics = useReadContract({
    address: CONTRACTS.launchFactory,
    abi: LaunchFactoryAbi,
    functionName: "previewQuoteEconomics",
    args: pairToken ? [LAUNCH_CONFIG_ID, pairToken] : undefined,
    chainId: arc.id,
    query: { enabled },
  })

  const digest = useReadContract({
    address: CONTRACTS.launchFactory,
    abi: LaunchFactoryAbi,
    functionName: "previewLaunchEconomics",
    args: pairToken ? [LAUNCH_CONFIG_ID, pairToken] : undefined,
    chainId: arc.id,
    query: { enabled: enabled && isNative },
  })

  return {
    priceable: isNative ? true : priceable.data,
    phantomQuote: economics.data,
    expectedEconomics: isNative ? (digest.data ?? zeroHash) : zeroHash,
  }
}

/* ── the launch itself ────────────────────────────────────────────── */

export type LaunchStatus = "idle" | "signing" | "mining" | "done" | "error"

export type Launch = {
  /** Simulation passed and the write is armed. */
  ready: boolean
  /** Human reason the simulation refused, if it did. */
  blocked?: string
  /** Simulation in flight. */
  checking: boolean
  status: LaunchStatus
  hash?: Hash
  token?: Address
  error?: string
  launch: () => void
  reset: () => void
  /** New salt → new address → new pool key. The `PoolAlreadyExists` retry. */
  reroll: () => void
}

const IDLE: Launch = {
  ready: false,
  checking: false,
  status: "idle",
  launch: () => {},
  reset: () => {},
  reroll: () => {},
}

export function useLaunch(
  params: TokenParams | undefined,
  pairToken: Address,
  /** The creator's opening buy, in native wei. 0n for none. */
  devBuyWei: bigint | undefined,
  active: boolean,
): Launch {
  if (!PRIVY_CONFIGURED) return IDLE

  /* eslint-disable react-hooks/rules-of-hooks */
  const { address, chainId } = useAccount()
  const { launchFee } = useLaunchTerms()

  // Cheap, instant, and answers the most common failure before the simulation
  // round-trips: the wallet simply cannot pay.
  const { data: balance } = useBalance({ address, chainId: arc.id })

  const onChain = chainId === arc.id
  const value = devBuyWei !== undefined ? launchFee + devBuyWei : undefined
  const canSim = active && !!params && !!address && onChain && value !== undefined

  /**
   * `buyLeg` is the route to the quote asset when the creator pays native for
   * an ERC-20-quoted pool. Empty for a native-quoted launch, which is the only
   * case the form offers today — an ERC-20 quote needs a route from the pricer
   * before this can be non-empty.
   */
  const buyLeg = [] as const

  /**
   * `minTokensOut` = 0 is safe HERE and nowhere else. This buy executes inside
   * the launch transaction, against a pool that did not exist a moment earlier
   * and opens at a price fixed by `phantomQuote`. There is no prior state to
   * sandwich, so there is no slippage to guard.
   */
  const sim = useSimulateContract({
    address: CONTRACTS.router,
    abi: RouterAbi,
    functionName: "launchAndBuyWithNative",
    args: params ? [params, LAUNCH_CONFIG_ID, pairToken, buyLeg, 0n] : undefined,
    value,
    chainId: arc.id,
    query: { enabled: canSim },
  })

  const { writeContract, data: hash, reset: resetWrite, status: writeStatus, error: writeError } =
    useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash, chainId: arc.id })

  const [rerolls, setRerolls] = React.useState(0)
  void rerolls // the caller re-derives `params` from it; this only forces the sim to refetch

  let blocked: string | undefined
  if (canSim && sim.error) blocked = blockReason(sim.error)
  else if (value !== undefined && balance && balance.value < value + GAS_HEADROOM_WEI) {
    blocked = "Not enough USDC in this wallet to cover the launch fee, the dev-buy and gas."
  }

  const status: LaunchStatus = receipt.isSuccess
    ? "done"
    : receipt.isLoading || writeStatus === "success"
      ? "mining"
      : writeStatus === "pending"
        ? "signing"
        : writeStatus === "error"
          ? "error"
          : "idle"

  return {
    ready: !!sim.data && !blocked,
    blocked,
    checking: canSim && sim.isLoading,
    status,
    hash,
    token: receipt.data ? tokenFromReceipt(receipt.data) : undefined,
    error: writeError ? shortMessage(writeError) : undefined,
    launch: () => {
      if (sim.data) writeContract(sim.data.request)
    },
    reset: resetWrite,
    reroll: () => setRerolls((n) => n + 1),
  }
  /* eslint-enable react-hooks/rules-of-hooks */
}
