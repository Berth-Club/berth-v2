import { NextResponse } from "next/server"
import { PrivyClient } from "@privy-io/server-auth"
import { createPublicClient, erc20Abi, formatUnits, http, isAddress as isAddr } from "viem"

import { arc, COIN_DECIMALS } from "@/lib/chain"
import { COMMENTS_ENABLED, addComment, listComments, recentCommentCount } from "@/lib/comments"
import { env } from "@/lib/env"
import { fmtAmount } from "@/lib/format"
import { serverEnv } from "@/lib/server-env"

export const runtime = "nodejs"

/** The poster's holding of this coin, pre-formatted ("22k"), for the design's
 *  holdings pill. A snapshot at post time — best-effort, never blocks the post. */
async function balanceLabel(coin: string, author: string): Promise<string | null> {
  if (!isAddr(author)) return null // did:privy fallback isn't an address
  try {
    const client = createPublicClient({ chain: arc, transport: http(env.rpcUrl) })
    const raw = await client.readContract({
      address: coin as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [author as `0x${string}`],
    })
    const n = Number(formatUnits(raw, COIN_DECIMALS))
    if (!isFinite(n) || n <= 0) return null
    return fmtAmount(n).toLowerCase() // "22K" -> "22k", matching the design
  } catch {
    return null
  }
}

const MAX_LEN = 280
const RATE_WINDOW_SEC = 60
const RATE_MAX = 5 // comments per author per window

let privyClient: PrivyClient | null = null
function privy(): PrivyClient | null {
  const appId = env.privyAppId
  const appSecret = serverEnv.privyAppSecret
  if (!appId || !appSecret) return null
  if (!privyClient) privyClient = new PrivyClient(appId, appSecret)
  return privyClient
}

function isAddress(v: string | null): v is string {
  return !!v && /^0x[0-9a-fA-F]{40}$/.test(v)
}

/** GET /api/comments?coin=0x… — newest-first list. Public, read-only. */
export async function GET(request: Request) {
  const coin = new URL(request.url).searchParams.get("coin")
  if (!isAddress(coin)) return NextResponse.json({ error: "bad coin" }, { status: 400 })
  const comments = await listComments(coin)
  return NextResponse.json({ comments })
}

/**
 * POST /api/comments — add a comment. Requires a Privy token (so only a
 * signed-in wallet can post), rate-limited per author, body length-capped.
 * The body is stored as-is and rendered as TEXT on the client, never as HTML.
 */
export async function POST(request: Request) {
  if (!COMMENTS_ENABLED) {
    return NextResponse.json({ code: "not_configured", message: "Comments aren't set up yet." }, { status: 503 })
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer /, "")
  if (!token) return NextResponse.json({ code: "unauthorized" }, { status: 401 })

  const client = privy()
  if (!client) {
    return NextResponse.json({ code: "not_configured", message: "Auth isn't configured." }, { status: 503 })
  }

  // Verifying the token is the auth check — a failure here IS a stale/invalid
  // session, so "reconnect" is the honest message.
  let userId: string
  try {
    ;({ userId } = await client.verifyAuthToken(token))
  } catch {
    return NextResponse.json(
      { code: "unauthorized", message: "Your session expired — reconnect your wallet." },
      { status: 401 }
    )
  }

  // The token is good; now resolve the wallet they signed in with. This call
  // authenticates with the app SECRET, so a failure here is OUR misconfig
  // (wrong/rotated PRIVY_APP_SECRET), not the user's session — don't tell them
  // to reconnect, and log the real reason so it's not invisible.
  let author: string
  try {
    const user = await client.getUser(userId)
    const wallet = user.linkedAccounts.find((a) => a.type === "wallet")
    author = (wallet && "address" in wallet ? (wallet.address as string) : userId).toLowerCase()
  } catch (e) {
    console.error("[comments] getUser failed — check PRIVY_APP_SECRET:", e)
    return NextResponse.json(
      { code: "server_error", message: "Chat is temporarily unavailable — try again shortly." },
      { status: 503 }
    )
  }

  let payload: { coin?: string; body?: string }
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 })
  }

  const coin = payload.coin ?? null
  if (!isAddress(coin)) return NextResponse.json({ error: "bad coin" }, { status: 400 })

  const body = (payload.body ?? "").trim()
  if (!body) return NextResponse.json({ code: "empty", message: "Say something first." }, { status: 422 })
  if (body.length > MAX_LEN) {
    return NextResponse.json({ code: "too_long", message: `Keep it under ${MAX_LEN} characters.` }, { status: 422 })
  }

  if ((await recentCommentCount(author, RATE_WINDOW_SEC)) >= RATE_MAX) {
    return NextResponse.json(
      { code: "rate_limited", message: "Slow down — a few seconds between messages." },
      { status: 429 }
    )
  }

  const balance = await balanceLabel(coin, author)
  const comment = await addComment(coin, author, body, balance)
  if (!comment) return NextResponse.json({ code: "failed", message: "Couldn't post." }, { status: 500 })
  return NextResponse.json({ comment })
}
