// POST /api/pin — authenticated image upload -> IPFS.
//
// The only place the Pinata JWT is used, and the only place uploaded bytes are
// validated. nodejs runtime (edge is deprecated in Next 16 and can't hold a
// server secret the way we want). The response `code` lets the client tell a
// rejected file (fix and retry) from an outage (offer a degraded launch) from
// an auth failure.

import { PrivyClient } from "@privy-io/server-auth"

import { MAX_BYTES, PinImageError, pinImage, validateAndReencode } from "@/lib/pin-image"

export const runtime = "nodejs"

function fail(status: number, code: string, message: string) {
  return Response.json({ code, message }, { status })
}

// ponytail: in-memory sliding window, keyed by the authenticated Privy user.
// Correct because the web app runs as ONE long-lived Railway instance — the map
// persists across requests. Move to Upstash/Redis if it ever scales horizontally.
const WINDOW_MS = 60 * 60 * 1000 // 1 hour
const MAX_PER_WINDOW = 10 // a launch is rare; 10 pins/hour/user is plenty
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
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID
  const appSecret = process.env.PRIVY_APP_SECRET
  if (!appId || !appSecret) return null
  if (!privyClient) privyClient = new PrivyClient(appId, appSecret)
  return privyClient
}

export async function POST(request: Request) {
  // 1. Authenticate the caller (a verified Privy token, not a spoofable address).
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "")
  if (!token) return fail(401, "unauthorized", "Sign in to upload art.")
  const client = privy()
  if (!client) return fail(503, "not_configured", "Uploads aren't configured yet.")

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

  // 3. Read the file (size ceiling also enforced by proxyClientMaxBodySize).
  const form = await request.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) return fail(400, "no_file", "No image was provided.")
  if (file.size > MAX_BYTES) return fail(422, "too_large", "Image is over the size limit.")
  const input = Buffer.from(await file.arrayBuffer())

  // 4. Validate + re-encode once. A rejection here is the creator's to fix.
  let reencoded
  try {
    reencoded = await validateAndReencode(input)
  } catch (e) {
    if (e instanceof PinImageError) return fail(422, e.code, e.message)
    return fail(422, "not_image", "That file isn't a valid image.")
  }

  // 5. Pin. A failure here is an OUTAGE (distinct 502) — the wizard maps it to
  //    the degraded emoji-only launch, NOT to "your file was bad".
  try {
    const cid = await pinImage(reencoded.bytes, "coin.webp")
    return Response.json({ cid, uri: `ipfs://${cid}` })
  } catch {
    return fail(502, "pin_unavailable", "Image pinning is unavailable right now.")
  }
}
