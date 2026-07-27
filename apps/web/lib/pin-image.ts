// Server-only. Validates an uploaded image and pins it to IPFS via Pinata.
//
// Two concerns, deliberately separate so the validation (the security-critical,
// network-free part) is unit-checkable on its own — see pin-image.selfcheck.ts:
//   - validateAndReencode(bytes): decode -> raster-allowlist -> re-encode ONCE
//   - pinImage(bytes): push those exact bytes to Pinata, return the CID
//
// The "re-encode ONCE" is load-bearing for the CREATE2 flow: the bytes we pin
// are the bytes the returned CID addresses, and that CID goes on-chain. Never
// re-encode after — a second encode yields different bytes -> a different CID ->
// the on-chain pointer no longer matches what is pinned.

import sharp from "sharp"

import { serverEnv } from "@/lib/server-env"

/** Raster only. SVG is excluded on purpose — served from a gateway it is a
 *  stored-XSS vector. We gate on the DECODED format, not the client mime. */
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp", "gif"])

/** Hard ceiling, checked before decode so a huge upload can't exhaust memory. */
export const MAX_BYTES = 5 * 1024 * 1024 // 5 MB
/** Coin logos are small; cap the longest edge and never upscale. */
const MAX_DIM = 1024

export type PinFailure =
  | "empty"
  | "too_large"
  | "not_image"
  | "bad_format"

export class PinImageError extends Error {
  code: PinFailure
  // Note: not a constructor parameter property — node's --experimental-strip-types
  // (used by the self-check) can't emit those.
  constructor(code: PinFailure, message: string) {
    super(message)
    this.code = code
    this.name = "PinImageError"
  }
}

export type ReencodedImage = { bytes: Buffer; contentType: "image/webp" }

/**
 * Decode, validate against the raster allowlist, and re-encode ONCE to webp
 * (resized to fit MAX_DIM). Throws PinImageError with a specific code on any
 * rejection. No network — safe to unit-check.
 */
export async function validateAndReencode(input: Buffer): Promise<ReencodedImage> {
  if (input.length === 0) throw new PinImageError("empty", "The file is empty.")
  if (input.length > MAX_BYTES) {
    throw new PinImageError("too_large", `Image is over the ${MAX_BYTES / 1024 / 1024} MB limit.`)
  }

  // Reject anything that doesn't decode as a real image — this catches SVG/HTML
  // polyglots and corrupt files regardless of the client-supplied Content-Type.
  let format: string | undefined
  try {
    format = (await sharp(input).metadata()).format
  } catch {
    throw new PinImageError("not_image", "That file isn't a readable image.")
  }
  if (!format || !ALLOWED_FORMATS.has(format)) {
    // Also catches an SVG that a librsvg-enabled sharp build WOULD decode
    // (format === "svg") — the allowlist is the authority, not sharp's ability.
    throw new PinImageError("bad_format", "Use a PNG, JPEG, WebP, or GIF image.")
  }

  const bytes = await sharp(input)
    .resize(MAX_DIM, MAX_DIM, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer()
  return { bytes, contentType: "image/webp" }
}

/**
 * Pin the (already validated + re-encoded) bytes to IPFS and return the CID.
 * The SDK client is built lazily so importing this module for the validation
 * checks never requires PINATA_JWT. Throws on any Pinata failure — the caller
 * maps that to the degraded launch path, distinct from a rejected file.
 */
export async function pinImage(bytes: Buffer, filename: string): Promise<string> {
  const jwt = serverEnv.pinataJwt
  if (!jwt) throw new Error("PINATA_JWT is not set")

  const { PinataSDK } = await import("pinata")
  const pinata = new PinataSDK({
    pinataJwt: jwt,
    // Raw value on purpose: the SDK wants a bare gateway host, not lib/env's
    // processed URL (which defaults + prefixes https://). Only used for reads,
    // not this upload.
    pinataGateway: process.env.NEXT_PUBLIC_IPFS_GATEWAY,
  })
  const file = new File([new Uint8Array(bytes)], filename, { type: "image/webp" })
  const res = await pinata.upload.public.file(file)
  if (!res?.cid) throw new Error("Pinata returned no CID")
  return res.cid
}
