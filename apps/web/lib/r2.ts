import "server-only"

import { randomUUID } from "node:crypto"

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

import { env } from "@/lib/env"
import { serverEnv } from "@/lib/server-env"

/**
 * Cloudflare R2 (S3-compatible) storage for profile avatars — mutable app data
 * that has no business on the content-addressed Pinata/IPFS pipeline (which
 * stays for coin images). Lazy client, mirroring `lib/pin-image.ts`: any missing
 * config => the whole module degrades to "unavailable" (callers get null) rather
 * than crashing a page.
 *
 * Object keys are RANDOM and opaque (`avatars/<uuid>.webp`), which:
 *   - is non-enumerable — a public bucket can't be walked wallet-by-wallet;
 *   - makes every replace mint a NEW url, so browsers/CDN never serve a stale
 *     avatar (no cache-busting needed). Only a moderation delete of an
 *     already-cached url needs a CDN purge (ops).
 * The old object is deleted on replace/remove by parsing its key back out of the
 * previously-stored public url (`keyFromUrl`).
 */

const cfg = serverEnv.r2

/** true only when R2 is fully configured (creds + bucket + public base). */
export const R2_ENABLED =
  !!cfg.accountId && !!cfg.accessKeyId && !!cfg.secretAccessKey && !!cfg.bucket && !!env.r2PublicBase

let client: S3Client | null = null
function r2(): S3Client | null {
  if (!R2_ENABLED) return null
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId!, secretAccessKey: cfg.secretAccessKey! },
    })
  }
  return client
}

/** Public https url for a stored object key, on the cookie-less R2 host. */
export function publicUrlFor(key: string): string {
  return `${env.r2PublicBase}/${key}`
}

/** The object key back out of a stored public url, or null if it isn't one of
 *  ours (guards delete against acting on an off-host url). */
export function keyFromUrl(url: string | null | undefined): string | null {
  const prefix = env.r2PublicBase + "/"
  if (!url || !env.r2PublicBase || !url.startsWith(prefix)) return null
  const key = url.slice(prefix.length)
  return key.startsWith("avatars/") ? key : null
}

/**
 * Store already-validated, re-encoded webp bytes (from `validateAndReencode`)
 * under a fresh random key; returns the public url, or null when R2 is off.
 * Long-cache is safe because the key is random — a new upload is a new url.
 */
export async function putAvatar(bytes: Buffer): Promise<string | null> {
  const c = r2()
  if (!c) return null
  const key = `avatars/${randomUUID()}.webp`
  await c.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: bytes,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    })
  )
  return publicUrlFor(key)
}

/** Delete the object a stored public url points at. No-op for a non-ours url. */
export async function deleteAvatarByUrl(url: string | null | undefined): Promise<void> {
  const c = r2()
  const key = keyFromUrl(url)
  if (!c || !key) return
  await c.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
}
