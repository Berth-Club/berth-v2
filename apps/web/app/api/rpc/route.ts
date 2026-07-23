import { NextResponse } from "next/server"

/**
 * Server-side JSON-RPC proxy.
 *
 * The browser needs a reliable Arc endpoint — the free public one drops
 * connections intermittently, which is what blanked the portfolio. The reliable
 * endpoint is a paid Alchemy URL whose API key sits in the path.
 *
 * That key must never reach the client. Putting it in `NEXT_PUBLIC_RPC_URL`
 * would inline it into every JS bundle we serve, where a scraper finds it in
 * minutes and burns the quota — taking the indexer down with it, since the
 * indexer depends on the same account. So the browser talks to this route, and
 * only this route knows the key.
 *
 * `RPC_URL` is deliberately NOT `NEXT_PUBLIC_`. If it is unset we fall through
 * to the public endpoint rather than failing: degraded is better than dead, and
 * it keeps local dev working without credentials.
 */
const UPSTREAM = process.env.RPC_URL ?? "https://rpc.testnet.arc.network"

/** Arc's own limit. Anything larger is not a real JSON-RPC call. */
const MAX_BODY = 1_000_000

export async function POST(req: Request) {
  const body = await req.text()
  if (body.length > MAX_BODY) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 })
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      // A hung upstream must not hold a server connection open indefinitely.
      signal: AbortSignal.timeout(30_000),
    })

    // Pass the payload through verbatim, including JSON-RPC error envelopes —
    // a revert is a legitimate answer that viem needs to decode, not a failure.
    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    })
  } catch {
    // Shaped as JSON-RPC so viem reports something useful rather than choking
    // on an HTML error page.
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: "upstream RPC unreachable" } },
      { status: 502 }
    )
  }
}
