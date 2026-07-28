import { notFound, redirect } from "next/navigation"

import { fetchCoinByTicker } from "@/lib/indexer"

export const dynamic = "force-dynamic"

/**
 * /coin/:ticker — the shareable, human-readable route. It resolves the ticker to
 * a coin and redirects to the canonical /token/:address view, which owns the
 * whole token screen (render, metadata, auto-refresh). One render path, no
 * duplication. On a ticker collision fetchCoinByTicker picks the newest launch.
 */
export default async function CoinByTicker({
  params,
}: {
  params: Promise<{ ticker: string }>
}) {
  const { ticker } = await params
  const coin = await fetchCoinByTicker(decodeURIComponent(ticker))
  if (!coin) notFound()
  redirect(`/token/${coin.address}`)
}
