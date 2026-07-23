"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

/**
 * Re-runs the server component tree on an interval so a server-rendered page
 * picks up new on-chain activity without a manual refresh.
 *
 * The token page fetches trades, chart, volume and holders once per request
 * (force-dynamic, but still one shot). `router.refresh()` re-fetches that server
 * data and reconciles it in place: no full reload, and client state survives —
 * the trade panel's amount input is not cleared out from under the user.
 *
 * Renders nothing. Pauses while the tab is hidden, because a backgrounded tab
 * has no reason to poll the RPC.
 */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter()

  React.useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh()
    }
    const id = window.setInterval(tick, seconds * 1000)
    // Refresh immediately on returning to the tab, not only on the next tick.
    document.addEventListener("visibilitychange", tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", tick)
    }
  }, [router, seconds])

  return null
}
