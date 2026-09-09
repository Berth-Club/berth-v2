// POST /api/avatar — authenticated image upload -> Cloudflare R2.
//
// The avatar analogue of /api/pin, but for MUTABLE profile avatars, so it lands
// in R2 (cheap, deletable) instead of IPFS. Reuses validateAndReencode (the same
// sharp decode + raster-allowlist + SVG-reject + 5MB cap + webp re-encode that
// guards coin art), so an SVG/polyglot can never be stored and served.
//
// Object keys are random (lib/r2.ts), so this endpoint needs only AUTH, not
// per-wallet authz: an uploaded object isn't "anyone's" until a wallet points
// its profile at the url via /api/profile (which is wallet-gated and also
// deletes the superseded object). nodejs runtime for the server secret + sharp.

import { PrivyClient } from "@privy-io/server-auth"

import { PROFILE_EDITING_ENABLED, env } from "@/lib/env"
import { MAX_BYTES, PinImageError, validateAndReencode } from "@/lib/pin-image"
import { R2_ENABLED, putAvatar } from "@/lib/r2"
import { serverEnv } from "@/lib/server-env"

export const runtime = "nodejs"

function fail(status: number, code: string, message: string) {
  return Response.json({ code, message }, { status })
}

// ponytail: in-memory sliding window per authenticated user, same as /api/pin —
// correct for the single long-lived Railway instance. Separate map/limit from
// pins since an avatar upload is a distinct, cheaper action.
const WINDOW_MS = 60 * 60 * 1000 // 1 hour
const MAX_PER_WINDOW = 20
const hits = new Map<string, number[]>()

function withinRateLimit(userId: string): boolean {
  const now = Date.now()
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS)
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(userId, recent)
    return false
  }
  recent.push(now)
  hits.set(userId, recent)
  return true
}

let privyClient: PrivyClient | null = null
function privy(): PrivyClient | null {
  const appId = env.privyAppId
  const appSecret = serverEnv.privyAppSecret
  if (!appId || !appSecret) return null
  if (!privyClient) privyClient = new PrivyClient(appId, appSecret)
  return privyClient
}

export async function POST(request: Request) {
  // Two separate 503s on purpose: an operator debugging a dead upload needs
  // to tell "someone flipped the flag" from "R2 creds are missing".
  if (!PROFILE_EDITING_ENABLED) return fail(503, "not_configured", "Profile editing is turned off.")
  if (!R2_ENABLED) return fail(503, "not_configured", "Avatar uploads aren't configured yet.")

  // 1. Authenticate (a verified Privy token, not a spoofable address).
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "")
  if (!token) return fail(401, "unauthorized", "Sign in to upload an avatar.")
  const client = privy()
  if (!client) return fail(503, "not_configured", "Auth isn't configured.")

  let userId: string
  try {
    userId = (await client.verifyAuthToken(token)).userId
  } catch {
    return fail(401, "unauthorized", "Your session expired — reconnect your wallet.")
  }

  // 2. Rate limit per authenticated user.
  if (!withinRateLimit(userId)) {
    return fail(429, "rate_limited", "Too many uploads — try again in a little while.")
  }

  // 3. Read the file (a hard ceiling before decode so a huge upload can't
  //    exhaust memory).
  const form = await request.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) return fail(400, "no_file", "No image was provided.")
  if (file.size > MAX_BYTES) return fail(422, "too_large", "Image is over the size limit.")
  const input = Buffer.from(await file.arrayBuffer())

  // 4. Validate + re-encode to webp once. Decodes with sharp, so SVG/HTML
  //    polyglots and corrupt files are rejected regardless of client mime.
  let reencoded
  try {
    reencoded = await validateAndReencode(input)
  } catch (e) {
    if (e instanceof PinImageError) return fail(422, e.code, e.message)
    return fail(422, "not_image", "That file isn't a valid image.")
  }

  // 5. Store under a fresh random key. A failure here is an outage.
  try {
    const url = await putAvatar(reencoded.bytes)
    if (!url) return fail(503, "not_configured", "Avatar storage is unavailable.")
    return Response.json({ url })
  } catch {
    return fail(502, "upload_unavailable", "Avatar upload is unavailable right now.")
  }
}
