// Pure coin-metadata builders. Kept out of lib/launch.ts (which is "use client"
// and pulls in React/viem/wagmi) so the determinism-critical logic can be
// checked under plain node — see metadata.selfcheck.ts.
//
// Determinism matters here: metadataURI is an ERC20 constructor arg, so it feeds
// the CREATE2 initcode hash. predict and deploy must be handed byte-identical
// input or the previewed token address is not the one that gets deployed.

/** Ticker rule: uppercase A-Z0-9, max 8. */
export function normalizeTicker(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)
}

/**
 * Build the metadata URI.
 *
 * There is no host to depend on: the metadata is inlined as a `data:` URI, so
 * the creator's lore + face survive the launch (the indexer reads them straight
 * back out of the event).
 *
 * `imageUri`, when given, is the creator's uploaded coin art as an `ipfs://CID`
 * (pinned server-side before this is called — see lib/pin-image.ts). When it is
 * absent (a launch with no upload, e.g. the degraded path when pinning is
 * unreachable) we keep a deterministic DiceBear placeholder. Only an `ipfs://`
 * image is treated as a real upload downstream — `toCoin` renders the emoji face
 * for anything else — so the placeholder is a harmless stand-in, not an identity.
 *
 * MUST be deterministic: key order is fixed, and the pinned CID is frozen before
 * it reaches here (never re-derived). Same inputs -> byte-identical output.
 */
export type CoinLinksInput = { twitter?: string; telegram?: string; website?: string }

export function buildMetadataURI(
  name: string,
  ticker: string,
  lore: string,
  emoji: string,
  imageUri?: string,
  links?: CoinLinksInput
): string {
  const symbol = normalizeTicker(ticker)
  // Base object, then optional link keys appended in a FIXED order. Determinism
  // is load-bearing: metadataURI feeds the CREATE2 initcode hash and the salt,
  // so the same inputs must always serialize byte-identically. Empty links are
  // omitted entirely rather than written as "".
  const meta: Record<string, string> = {
    name: name.trim(),
    symbol,
    description: lore.trim(),
    emoji,
    image: imageUri ?? `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(symbol || "berth")}`,
  }
  const tw = links?.twitter?.trim()
  const tg = links?.telegram?.trim()
  const web = links?.website?.trim()
  if (tw) meta.twitter = tw
  if (tg) meta.telegram = tg
  if (web) meta.website = web
  // Not base64: plain JSON keeps it readable on the explorer and in the event.
  return `data:application/json,${encodeURIComponent(JSON.stringify(meta))}`
}
