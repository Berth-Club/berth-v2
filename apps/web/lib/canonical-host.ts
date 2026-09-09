/**
 * The app answers on more than one hostname: berth.club, www.berth.club, and
 * the Railway-generated bridgedotclub-web-production.up.railway.app, which is
 * public and serves byte-identical content. `app/robots.ts` uses this to serve
 * allow-all on the real domain and disallow-all everywhere else, so the
 * platform host stops being indexable as a duplicate of the site.
 */
export const CANONICAL_HOSTS = new Set(["berth.club", "www.berth.club"])

/**
 * Whether a request's Host header names something other than the real site.
 *
 * FAIL OPEN: a missing or empty host returns false (treat as canonical, allow
 * crawling). Getting that backwards would deindex berth.club, which is far
 * worse than leaving a stray platform hostname crawlable for another day.
 */
export function isOffCanonicalHost(host: string | null | undefined): boolean {
  const h = host?.split(":")[0]?.trim().toLowerCase()
  if (!h) return false
  return !CANONICAL_HOSTS.has(h)
}
