// Reserved names/tickers that impersonate the platform itself.
// Exact match on name (case-insensitive); ticker checked as uppercase substring.

const RESERVED_NAMES = new Set([
  "berth",
  "berth club",
  "berth.club",
  "arc berth",
])

const RESERVED_TICKERS = new Set([
  "BERTH",
])

export function isNameBlocked(name: string): boolean {
  return RESERVED_NAMES.has(name.toLowerCase().trim())
}

export function isTickerBlocked(ticker: string): boolean {
  return RESERVED_TICKERS.has(ticker)
}
