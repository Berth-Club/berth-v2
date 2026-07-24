import { NextResponse } from "next/server"
import { PrivyClient } from "@privy-io/server-auth"

import { COMMENTS_ENABLED, addComment, listComments, recentCommentCount } from "@/lib/comments"

export const runtime = "nodejs"

const MAX_LEN = 280
const RATE_WINDOW_SEC = 60
const RATE_MAX = 5 // comments per author per window

let privyClient: PrivyClient | null = null
function privy(): PrivyClient | null {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID
  const appSecret = process.env.PRIVY_APP_SECRET
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

  let author: string
  try {
    // The verified user id is opaque; we want the wallet they signed in with.
    const { userId } = await client.verifyAuthToken(token)
    const user = await client.getUser(userId)
    const wallet = user.linkedAccounts.find((a) => a.type === "wallet")
    author = (wallet && "address" in wallet ? (wallet.address as string) : userId).toLowerCase()
  } catch {
    return NextResponse.json(
      { code: "unauthorized", message: "Your session expired — reconnect your wallet." },
      { status: 401 }
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
      { code: "rate_limited", message: "Slow down, captain — a few seconds between messages." },
      { status: 429 }
    )
  }

  const comment = await addComment(coin, author, body)
  if (!comment) return NextResponse.json({ code: "failed", message: "Couldn't post." }, { status: 500 })
  return NextResponse.json({ comment })
}
