"use client"

import * as React from "react"

import { useWallet } from "@/components/wallet-provider"

type Comment = { id: string; author: string; body: string; createdAt: number }

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}
function ago(ts: number) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

const MAX = 280

/** A deterministic periwinkle-family avatar from an address — gives the thread
 *  visual rhythm without needing real profile images. */
function avatarStyle(seed: string): React.CSSProperties {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const a = 200 + (h % 40) // 200–240° — stays in the blue/periwinkle band
  const b = (h >> 8) % 30
  return { background: `linear-gradient(135deg, hsl(${a} 60% 70%), hsl(${a - 30 - b} 55% 48%))` }
}

/**
 * The comment thread for a coin. Reads are public; posting needs a connected
 * wallet (the API verifies a Privy token). Bodies are rendered as text, never
 * HTML — the store keeps them raw and React escapes on render.
 */
export function CoinComments({ coin }: { coin: string }) {
  const { connected, connect, getAccessToken, address } = useWallet()
  const [comments, setComments] = React.useState<Comment[] | null>(null)
  const [body, setBody] = React.useState("")
  const [posting, setPosting] = React.useState(false)
  const [error, setError] = React.useState<string>()
  // Set when Post is clicked while disconnected — fires the post once the wallet
  // connects, so "Connect & post" is one motion, not two clicks.
  const [pending, setPending] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/comments?coin=${coin}`, { cache: "no-store" })
      const data = (await res.json()) as { comments?: Comment[] }
      setComments(data.comments ?? [])
    } catch {
      setComments([])
    }
  }, [coin])

  React.useEffect(() => {
    void load()
    // Poll so a busy thread updates without a reload.
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, 20_000)
    return () => window.clearInterval(id)
  }, [load])

  const post = React.useCallback(async () => {
    const text = body.trim()
    if (!text || posting) return
    setPosting(true)
    setError(undefined)
    try {
      const token = getAccessToken ? await getAccessToken() : null
      if (!token) {
        setError("Sign in to post.")
        return
      }
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ coin, body: text }),
      })
      const data = (await res.json().catch(() => ({}))) as { comment?: Comment; message?: string }
      if (res.ok && data.comment) {
        setComments((prev) => [data.comment!, ...(prev ?? [])])
        setBody("")
      } else {
        setError(data.message ?? "Couldn't post.")
      }
    } catch {
      setError("Couldn't reach the harbor.")
    } finally {
      setPosting(false)
    }
  }, [body, posting, coin, getAccessToken])

  // Post if connected; otherwise open the wallet and remember to post after.
  const submit = React.useCallback(() => {
    if (connected) {
      void post()
      return
    }
    setPending(true)
    connect()
  }, [connected, connect, post])

  // The wallet just connected with a queued post — send it.
  React.useEffect(() => {
    if (connected && pending) {
      setPending(false)
      void post()
    }
  }, [connected, pending, post])

  return (
    <section className="rounded-card bg-hull border p-4" style={{ borderColor: "rgba(148,168,196,0.2)" }}>
      <h2 className="text-mist mb-3 text-[13px] font-bold" style={{ letterSpacing: 1 }}>
        DECK CHATTER {comments && comments.length > 0 && <span className="text-faint">· {comments.length}</span>}
      </h2>

      {/* composer — always shown. The wallet gate is deferred to the Post click:
          if you're not connected yet, Post opens the wallet, then you post. */}
      <div className="mb-5 flex flex-col gap-2.5">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 size-8 shrink-0 rounded-full" style={avatarStyle(address ?? "you")} />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX))}
            rows={2}
            placeholder="Say something to the deck…"
            className="bg-deep rounded-btn focus:border-lime min-w-0 flex-1 resize-none border p-2.5 text-sm outline-none"
            style={{ borderColor: "rgba(148,168,196,0.2)" }}
          />
        </div>
        <div className="flex items-center justify-end gap-3 pl-[42px]">
          {error && (
            <span className="mr-auto text-[13px]" style={{ color: "#de8092" }}>
              {error}
            </span>
          )}
          <span className="text-faint tabular text-[11px]">
            {body.length}/{MAX}
          </span>
          <button
            onClick={submit}
            disabled={!body.trim() || posting}
            className="btn-deck btn-lime rounded-btn px-4 py-1.5 text-sm disabled:opacity-40"
          >
            {posting ? "Posting…" : connected ? "Post" : "Connect & post"}
          </button>
        </div>
      </div>

      {/* thread */}
      {comments === null ? (
        <p className="text-faint py-6 text-center text-[13px]">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-mist py-6 text-center text-[13px]">Quiet on deck. Break the silence.</p>
      ) : (
        <ul className="flex flex-col gap-4 border-t pt-4" style={{ borderColor: "rgba(148,168,196,0.14)" }}>
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5 text-sm">
              <div className="mt-0.5 size-8 shrink-0 rounded-full" style={avatarStyle(c.author)} />
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-2">
                  <span className="tabular text-lime text-xs">{short(c.author)}</span>
                  <span className="text-faint text-[11px]">{ago(c.createdAt)}</span>
                </div>
                <p className="text-body2 whitespace-pre-wrap break-words">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
