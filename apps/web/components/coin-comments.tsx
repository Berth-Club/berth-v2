"use client"

import * as React from "react"

import { UserAvatar } from "@/components/user-avatar"
import { useWallet } from "@/components/wallet-provider"

type Comment = {
  id: string
  author: string
  body: string
  createdAt: number
  balance: string | null
  name: string | null
  image: string | null
}

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

/**
 * The comment thread for a coin. Reads are public; posting needs a connected
 * wallet (the API verifies a Privy token). Bodies are rendered as text, never
 * HTML — the store keeps them raw and React escapes on render.
 */
export function CoinComments({ coin, symbol }: { coin: string; symbol: string }) {
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

  // The card chrome belongs to the page (a .glass panel) — this renders its
  // contents only, so the chat sits in the same surface as swap and market.
  return (
    <>
      <div className="flex items-center gap-2.5">
        <h2 className="font-display text-[17px]">Chat</h2>
        {comments && comments.length > 0 && (
          <span
            className="tabular bg-deep text-body2 rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold"
            style={{ border: "1px solid rgba(148,168,196,.2)" }}
          >
            {comments.length}
          </span>
        )}
      </div>
      <p className="text-faint my-[7px] mb-3 text-[12.5px]">
        Holders can post. Links are not allowed.
      </p>

      {/* thread — grows to fill the card so the composer sits at the bottom */}
      <div className="flex min-h-0 flex-1 flex-col">
        {comments === null ? (
          <p className="text-faint m-auto text-center text-[13px]">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="text-mist m-auto text-center text-[13px]">Quiet on deck. Break the silence.</p>
        ) : (
          <ul className="flex flex-col overflow-y-auto">
            {comments.map((c) => (
            <li
              key={c.id}
              className="flex gap-2.5 py-[11px] text-sm"
              style={{ borderBottom: "1px solid rgba(148,168,196,0.14)" }}
            >
              <UserAvatar address={c.author} image={c.image} />
              <div className="min-w-0 flex-1">
                <div className="text-faint flex flex-wrap items-center gap-[7px] text-xs">
                  {c.name ? (
                    <>
                      <span className="text-body2 max-w-[10rem] truncate font-semibold">{c.name}</span>
                      <span className="tabular text-faint text-[11px]">{short(c.author)}</span>
                    </>
                  ) : (
                    <span className="tabular text-body2 font-semibold">{short(c.author)}</span>
                  )}
                  {c.balance && (
                    <span
                      className="rounded-full px-[7px] py-[2px] font-mono text-[10px]"
                      style={{ color: "#93a8c4", background: "#0b1929" }}
                    >
                      {c.balance} ${symbol}
                    </span>
                  )}
                  <span className="ml-auto">{ago(c.createdAt)}</span>
                </div>
                <p className="text-body2 mt-[3px] whitespace-pre-wrap break-words text-[13.5px]">
                  {c.body}
                </p>
              </div>
            </li>
            ))}
          </ul>
        )}
      </div>

      {/* composer — always shown. The wallet gate is deferred to the Post click:
          if you're not connected yet, Post opens the wallet, then you post. */}
      {connected ? (
        <div className="mt-3.5 flex flex-col gap-2">
          <div className="flex gap-2">
            <UserAvatar address={address ?? "you"} />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, MAX))}
              onKeyDown={(e) => {
                // Enter posts; Shift+Enter keeps its newline.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              rows={2}
              placeholder="Signal the fleet…"
              className="well min-w-0 flex-1 resize-none rounded-xl p-3 text-[13.5px] outline-none"
            />
          </div>
          <div className="flex items-center justify-end gap-3">
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
              className="btn-glossy px-[18px] py-2.5 text-[13.5px]"
            >
              {posting ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={submit} className="btn-glossy mt-3.5 w-full py-3 text-[15px]">
          Connect to chat
        </button>
      )}
    </>
  )
}
