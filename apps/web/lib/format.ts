// Number formatting. Real values will come from viem `formatUnits`/`formatEther`
// upstream; these handle presentation only. Numbers always render tabular + 700.

/**
 * Prices are tiny (opening mcap ~0.216 WETH → ~$0.0000000073 per token), so
 * never use toPrecision/exponent notation — the spec shows full decimals.
 */
export function fmtPrice(usd: number): string {
  if (!isFinite(usd) || usd === 0) return "$0"
  if (usd >= 0.01) {
    return `$${usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
  }
  // Show 2 significant digits, expanded — e.g. 0.0000000073
  const decimals = Math.min(18, Math.max(0, -Math.floor(Math.log10(usd)) + 1))
  return `$${usd.toFixed(decimals)}`
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
