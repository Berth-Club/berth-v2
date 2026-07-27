"use client"

import * as React from "react"

/**
 * The ☆ watchlist. Purely local — a starred coin is a browsing preference, not
 * an on-chain fact, so it lives in localStorage and needs no wallet.
 *
 * Keyed by coin ADDRESS, not ticker: tickers are user-chosen and duplicate
 * freely on a launchpad, so starring $DOG would otherwise star every $DOG.
 */
const KEY = "berth.watchlist"

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
  } catch {
    return []
  }
}

export function useWatchlist() {
  // Starts empty on both server and first client render — reading localStorage
  // during render would hydrate-mismatch every starred card.
  const [watched, setWatched] = React.useState<Set<string>>(() => new Set())

  React.useEffect(() => {
    setWatched(new Set(read().map((a) => a.toLowerCase())))
  }, [])

  const toggle = React.useCallback((address: string) => {
    const key = address.toLowerCase()
    setWatched((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try {
        window.localStorage.setItem(KEY, JSON.stringify([...next]))
      } catch {
        // private mode / quota — the star still works for this session
      }
      return next
    })
  }, [])

  const isWatched = React.useCallback((address: string) => watched.has(address.toLowerCase()), [watched])

  return { watched, isWatched, toggle }
}
