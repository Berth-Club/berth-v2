"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

/**
 * A coin that's confirmed ON-CHAIN but not yet in the indexer — i.e. a launch
 * that just landed. The indexer catches up in a few seconds; until then the
 * token page would 404. So instead of 404, we poll: router.refresh() re-runs
 * the server page (re-reading the indexer), and the moment the coin appears the
 * real page renders in place of this. Bounded so a non-berth contract address
 * doesn't refresh forever.
 */
export function PendingCoin({ address }: { address: string }) {
  const router = useRouter()
  const [tries, setTries] = React.useState(0)
  const MAX = 20 // ~60s at 3s; a launch indexes in seconds — this is the give-up

  React.useEffect(() => {
    if (tries >= MAX) return
    const id = setTimeout(() => {
      setTries((n) => n + 1)
      router.refresh()
    }, 3000)
    return () => clearTimeout(id)
  }, [tries, router])

  const gaveUp = tries >= MAX

  return (
    <div className="mx-auto flex min-h-[68vh] max-w-[520px] flex-col items-center justify-center px-5 text-center">
      {gaveUp ? (
        <>
          <div className="font-display text-[22px]">Still no sign of this coin.</div>
          <p className="text-mist mt-2 text-[14px]">
            We couldn&apos;t find <span className="tabular break-all">{address}</span> in the harbor.
            If you just launched it, give it a moment and refresh.
          </p>
          <button onClick={() => router.refresh()} className="btn-glossy mt-5 px-5 py-2.5 text-[14px]">
            Try again
          </button>
        </>
      ) : (
        <>
          <span className="mb-4 inline-flex items-center gap-2" role="status" aria-label="indexing">
            {[0, 160, 320].map((d) => (
              <span
                key={d}
                className="size-2.5 animate-pulse rounded-full bg-current opacity-40"
                style={{ animationDelay: `${d}ms` }}
              />
            ))}
          </span>
          <div className="font-display text-[22px]">Docking your launch…</div>
          <p className="text-mist mt-2 text-[14px]">
            It&apos;s live on-chain — the harbor is just logging it. This page fills in on its own.
          </p>
        </>
      )}
    </div>
  )
}
