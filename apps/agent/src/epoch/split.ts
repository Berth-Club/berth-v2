/**
 * Turn a week's scores into whole-unit amounts that add up exactly.
 *
 * Integer arithmetic throughout. These are token amounts in base units, so a
 * float would start losing the low digits somewhere around eighteen of them and
 * the loss would look like rounding rather than like a bug. Every value here is
 * a bigint from the moment it enters.
 *
 * The remainder problem is the whole job. Three wallets splitting 100 units by
 * equal score get 33 each and one unit is left over. Dropping it strands dust in
 * the vault forever; handing it to whoever sorts first quietly pays a bonus for
 * having a low address. So the leftover goes by largest fractional part, and
 * ties inside that break on the wallet address, which is arbitrary but fixed and
 * checkable. The total paid always equals the pot exactly.
 */

export interface Contribution {
  wallet: string
  /** Sum of this wallet's item scores for the week. */
  score: number
}

export interface Share {
  wallet: string
  score: number
  coinAmount: bigint
  usdcAmount: bigint
}

export interface SplitResult {
  shares: Share[]
  coinTotal: bigint
  usdcTotal: bigint
  /** Wallets with a score but no payable amount, kept out of the tree. */
  dustedWallets: string[]
}

/**
 * Split `coinPot` and `usdcPot` across wallets in proportion to score.
 *
 * Wallets are returned sorted by address so the leaf order is a pure function
 * of the inputs. The tree's root has to be reproducible by anyone checking the
 * payout, and an order that depended on a query's row order would not be.
 */
export function splitPot(
  contributions: readonly Contribution[],
  coinPot: bigint,
  usdcPot: bigint
): SplitResult {
  const earning = contributions
    .filter((c) => c.score > 0)
    .map((c) => ({ wallet: c.wallet.toLowerCase(), score: c.score }))

  if (earning.length === 0) {
    return { shares: [], coinTotal: 0n, usdcTotal: 0n, dustedWallets: [] }
  }

  // Merge repeats: one wallet may have several contributions in a week.
  const byWallet = new Map<string, number>()
  for (const c of earning) byWallet.set(c.wallet, (byWallet.get(c.wallet) ?? 0) + c.score)

  const wallets = [...byWallet.entries()]
    .map(([wallet, score]) => ({ wallet, score }))
    .sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0))

  const totalScore = BigInt(wallets.reduce((sum, w) => sum + w.score, 0))
  const coin = allocate(wallets, coinPot, totalScore)
  const usdc = allocate(wallets, usdcPot, totalScore)

  const shares: Share[] = []
  const dustedWallets: string[] = []
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i]!
    const coinAmount = coin[i]!
    const usdcAmount = usdc[i]!
    // The leaf CHECK refuses a row that is zero on both sides, and a leaf worth
    // nothing is a claim transaction that costs more than it pays.
    if (coinAmount === 0n && usdcAmount === 0n) {
      dustedWallets.push(w.wallet)
      continue
    }
    shares.push({ wallet: w.wallet, score: w.score, coinAmount, usdcAmount })
  }

  return {
    shares,
    coinTotal: shares.reduce((s, x) => s + x.coinAmount, 0n),
    usdcTotal: shares.reduce((s, x) => s + x.usdcAmount, 0n),
    dustedWallets,
  }
}

/**
 * Largest-remainder allocation: floor everyone, then hand out what is left.
 *
 * The floors always sum to at most the pot, and the shortfall is always fewer
 * units than there are wallets, so one extra unit each to the largest remainders
 * closes it exactly. No loop, no drift, no dust.
 */
function allocate(
  wallets: readonly { wallet: string; score: number }[],
  pot: bigint,
  totalScore: bigint
): bigint[] {
  if (pot <= 0n || totalScore <= 0n) return wallets.map(() => 0n)

  const base: bigint[] = []
  const remainders: { index: number; rem: bigint; wallet: string }[] = []
  let handedOut = 0n

  for (let i = 0; i < wallets.length; i++) {
    const scaled = pot * BigInt(wallets[i]!.score)
    const share = scaled / totalScore
    base.push(share)
    handedOut += share
    remainders.push({ index: i, rem: scaled % totalScore, wallet: wallets[i]!.wallet })
  }

  let leftover = pot - handedOut
  // Largest remainder first; the address breaks ties so the result is fixed.
  remainders.sort((a, b) =>
    a.rem === b.rem ? (a.wallet < b.wallet ? -1 : 1) : a.rem > b.rem ? -1 : 1
  )
  for (const r of remainders) {
    if (leftover <= 0n) break
    base[r.index] = base[r.index]! + 1n
    leftover -= 1n
  }

  return base
}
