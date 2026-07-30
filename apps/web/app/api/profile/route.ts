import { NextResponse } from "next/server"
import { PrivyClient } from "@privy-io/server-auth"

import { env } from "@/lib/env"
import { parseProfileInput } from "@/lib/profile-input"
import { PROFILES_ENABLED, getProfile, getProfiles, upsertProfile } from "@/lib/profiles"
import { deleteAvatarByUrl, keyFromUrl } from "@/lib/r2"
import { serverEnv } from "@/lib/server-env"

export const runtime = "nodejs"

function isAddress(v: string | null | undefined): v is string {
  return !!v && /^0x[0-9a-fA-F]{40}$/.test(v)
}

let privyClient: PrivyClient | null = null
function privy(): PrivyClient | null {
  const appId = env.privyAppId
  const appSecret = serverEnv.privyAppSecret
  if (!appId || !appSecret) return null
  if (!privyClient) privyClient = new PrivyClient(appId, appSecret)
  return privyClient
}

/**
 * GET /api/profile?address=0x…            -> { profile }        (single, or null)
 * GET /api/profile?addresses=0x…,0x…,…    -> { profiles: {addr: profile} }  (batch)
 * Public, read-only.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const batch = params.get("addresses")
  if (batch !== null) {
    const addrs = batch.split(",").map((a) => a.trim()).filter(isAddress)
    const map = await getProfiles(addrs)
    return NextResponse.json({ profiles: Object.fromEntries(map) })
  }
  const address = params.get("address")
  if (!isAddress(address)) return NextResponse.json({ error: "bad address" }, { status: 400 })
  return NextResponse.json({ profile: await getProfile(address) })
}

/**
 * POST /api/profile — create or replace the CALLER's own profile. Requires a
 * Privy token; the profile is always written for the wallet resolved from that
 * token, never an address in the body (so it can't be used to write someone
 * else's row).
 */
export async function POST(request: Request) {
  if (!PROFILES_ENABLED) {
    return NextResponse.json({ code: "not_configured", message: "Profiles aren't set up yet." }, { status: 503 })
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer /, "")
  if (!token) return NextResponse.json({ code: "unauthorized" }, { status: 401 })

  const client = privy()
  if (!client) {
    return NextResponse.json({ code: "not_configured", message: "Auth isn't configured." }, { status: 503 })
  }

  // Verifying the token IS the auth check — a failure is a stale/invalid session.
  let userId: string
  try {
    ;({ userId } = await client.verifyAuthToken(token))
  } catch {
    return NextResponse.json(
      { code: "unauthorized", message: "Your session expired — reconnect your wallet." },
      { status: 401 }
    )
  }

  // Resolve the wallet they signed in with. This uses the app SECRET, so a
  // failure here is our misconfig, not the user's session.
  let wallet: string
  try {
    const user = await client.getUser(userId)
    const linked = user.linkedAccounts.find((a) => a.type === "wallet")
    wallet = (linked && "address" in linked ? (linked.address as string) : userId).toLowerCase()
  } catch (e) {
    console.error("[profile] getUser failed — check PRIVY_APP_SECRET:", e)
    return NextResponse.json(
      { code: "server_error", message: "Profiles are temporarily unavailable — try again shortly." },
      { status: 503 }
    )
  }
  if (!isAddress(wallet)) {
    return NextResponse.json(
      { code: "no_wallet", message: "Connect a wallet before setting a profile." },
      { status: 422 }
    )
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 })
  }

  const parsed = parseProfileInput(raw)
  if (!parsed.ok) {
    return NextResponse.json({ code: parsed.code, message: parsed.message }, { status: 422 })
  }

  // The image this wallet had before this write — so a replaced or removed R2
  // avatar's object can be cleaned up once the new value is persisted.
  const prevImage = (await getProfile(wallet))?.image ?? null

  // Only ever the token's wallet — any address in the body is ignored.
  const profile = await upsertProfile(wallet, parsed.data)
  if (!profile) return NextResponse.json({ code: "failed", message: "Couldn't save your profile." }, { status: 500 })

  // Best-effort: delete the superseded R2 object (guarded to our host by
  // keyFromUrl, so legacy ipfs:// values and coin CIDs are never touched).
  // Never block the response on it.
  if (prevImage && prevImage !== profile.image && keyFromUrl(prevImage)) {
    void deleteAvatarByUrl(prevImage).catch((e) => console.error("[profile] avatar cleanup failed", e))
  }

  return NextResponse.json({ profile })
}
