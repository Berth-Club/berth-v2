// Ticker normalisation. Kept out of lib/launch.ts (which is "use client" and
// pulls in React/viem/wagmi) so it can be used from anywhere.
//
// v2 removed the metadata builder that used to live here: logo, description and
// socials are first-class constructor args on the token now, so there is no
// `data:` URI to assemble and no CREATE2 initcode hash riding on its byte order.

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
