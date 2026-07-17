// Number formatting. Real values come from viem `formatUnits`/`formatEther`
// upstream; these handle presentation only. Numbers always render tabular + 700.

const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉"

/** 12 -> "₁₂" */
function toSubscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPTS[Number(d)])
    .join("")
}

/**
 * Prices here are absurdly small — a coin opens at ~0.216 WETH market cap over
 * a fixed 100B supply, so ~$0.0000000041 per token. Printing that literally is
 * nine leading zeros nobody can count at a glance, and it gets worse the lower
 * the price goes.
 *
 * So: subscript notation, the convention DEX Screener / Uniswap use —
 *   0.0000000041  ->  $0.0₈41
 * where the subscript is the COUNT of zeros after the decimal point. Compact,
 * unambiguous, and it stays one line at any magnitude.
 *
 * Never exponent notation ($4.1e-9): it reads as a rounding artifact rather
 * than a price, which is exactly the confusion this replaces.
 */
export function fmtPrice(usd: number): string {
  if (!isFinite(usd) || usd <= 0) return "$0"
  // Normal money: $1.23, $0.42
  if (usd >= 0.01) return `$${usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`

  // toExponential does the hard parts for us: rounds to 2 significant digits AND
  // carries correctly (9.99e-9 -> "1.0e-8"). Deriving the zero count from
  // Math.log10 instead is off by one on exact powers of ten and mis-carries on
  // round-up — both shipped wrong before this.
  const [mantissa, expPart] = usd.toExponential(1).split("e")
  const exp = Number(expPart)
  const zeros = -exp - 1 // zeros between "0." and the first significant digit
  const digits = mantissa!.replace(".", "") // "4.1" -> "41"

  // Under 4 zeros the plain form still reads fine, and is less clever than a glyph.
  if (zeros < 4) {
    return `$${usd.toFixed(zeros + 2).replace(/0+$/, "").replace(/\.$/, "")}`
  }

  return `$0.0${toSubscript(zeros)}${digits}`
}

/** Compact market cap: $736, $41.2K, $1.2M. */
export function fmtMc(usd: number): string {
  return `$${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(usd)}`
}

/** Compact token amounts: 69.4M. */
export function fmtAmount(n: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n)
}
