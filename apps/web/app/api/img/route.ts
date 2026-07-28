// GET /api/img?cid=<ipfs-path> — cache + serve coin art.
//
// The public IPFS gateway is slow (multi-second TTFB even for an 18KB file), so
// coin images crawl in. This proxies them: fetch from the gateway ONCE, hold the
// bytes in memory, and serve with an immutable cache header. A CID is content-
// addressed and never changes, so caching forever is safe. First view of a coin
// pays the gateway latency once; every load after that (any user, any refresh)
// is instant from memory + the browser cache.

import { env } from "@/lib/env"

export const runtime = "nodejs"

// Bounded in-memory cache — the web app is one long-lived Railway instance, so
// the map persists across requests. Simple FIFO eviction; coin art is tiny.
const MAX_ENTRIES = 300
const cache = new Map<string, { body: Buffer; type: string }>()

// A CID path: base32/58 CID optionally followed by a filename. No traversal.
const CID_PATH = /^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9._-]+)*$/

function serve(entry: { body: Buffer; type: string }) {
  return new Response(new Uint8Array(entry.body), {
    headers: {
      "content-type": entry.type,
      // Content-addressed → immutable. Cache hard, everywhere.
      "cache-control": "public, max-age=31536000, immutable",
    },
  })
}

export async function GET(request: Request) {
  const cid = new URL(request.url).searchParams.get("cid")
  if (!cid || cid.includes("..") || !CID_PATH.test(cid)) {
    return new Response("bad cid", { status: 400 })
  }

  const hit = cache.get(cid)
  if (hit) return serve(hit)

  try {
    const res = await fetch(`${env.ipfsGateway}/ipfs/${cid}`, {
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return new Response("upstream", { status: 502 })
    const type = res.headers.get("content-type") ?? "application/octet-stream"
    // Only ever serve images — never let this become an open proxy for arbitrary content.
    if (!type.startsWith("image/")) return new Response("not an image", { status: 415 })

    const body = Buffer.from(await res.arrayBuffer())
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
    cache.set(cid, { body, type })
    return serve({ body, type })
  } catch {
    return new Response("fetch failed", { status: 502 })
  }
}
