"use client"

import * as React from "react"

import { fmtPrice } from "@/lib/format"

/**
 * Flagship price ticks ±2% every 2s for a live feel. Starts from the exact
 * server value so the first paint matches SSR (no hydration mismatch).
 */
export function JitterPrice({ base }: { base: number }) {
  const [price, setPrice] = React.useState(base)

  React.useEffect(() => {
    const id = window.setInterval(() => {
      setPrice(base * (1 + (Math.random() - 0.5) * 0.04))
    }, 2000)
    return () => window.clearInterval(id)
  }, [base])

  return <span className="tabular">{fmtPrice(price)}</span>
}
