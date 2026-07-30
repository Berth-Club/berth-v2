import { CoinAvatar } from "@/components/coin-avatar"
import Link from "next/link"
import { notFound } from "next/navigation"

import { ProfileEditor } from "@/components/profile-editor"
import { UserAvatar } from "@/components/user-avatar"
import { fmtMc } from "@/lib/format"
import { fetchCaptain, fetchCaptains, fetchCoinsByCreator } from "@/lib/indexer"
import { httpUrlOrNull } from "@/lib/profile-input"
import { getProfile } from "@/lib/profiles"

export const dynamic = "force-dynamic"

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function since(unix: number): string {
  const days = Math.floor((Date.now() / 1000 - unix) / 86400)
  if (days < 1) return "today"
  return `${days}d ago`
}

export default async function UserPage({
  params,
}: {
  params: Promise<{ address: string }>
}) {
  const { address } = await params
  const addr = decodeURIComponent(address)

  const [captain, created, all, profile] = await Promise.all([
    fetchCaptain(addr),
    fetchCoinsByCreator(addr),
    fetchCaptains(),
    getProfile(addr),
  ])

  // 404 only when there's NOTHING to show — neither chain activity nor a profile.
  // A wallet that onboarded and set a profile but never traded still has a page.
  if (!captain && !profile) notFound()

  // Prefer the captain's canonical address; fall back to the route param for a
  // profile-only wallet with no captain row.
  const displayAddress = captain?.address ?? addr
  const rank = all
    ? all.findIndex((c) => c.address.toLowerCase() === displayAddress.toLowerCase()) + 1
    : 0

  return (
    <div className="mx-auto max-w-[900px] px-5 pb-20 pt-6">
      <Link
        href="/"
        className="text-mist hover:text-foam text-sm font-bold transition-colors"
      >
        ← Back to harbor
      </Link>

      {/* profile */}
      <div className="glass mt-5 flex flex-wrap items-center gap-5 p-6">
        <UserAvatar
          address={displayAddress}
          image={profile?.image}
          size={84}
          style={{ border: "2px solid #8fb0e8" }}
        />

        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[30px] leading-tight">
            {profile?.name ?? short(displayAddress)}
          </h1>
          <div className="tabular text-mist break-all text-sm">{displayAddress}</div>
          {profile?.bio && <p className="text-body2 mt-2 max-w-prose text-sm">{profile.bio}</p>}
          <div className="text-mist mt-1 flex flex-wrap items-center gap-x-3 text-[13px]">
            {captain && (
              <span>
                Docked <span className="tabular">{since(captain.firstSeenAt)}</span>
              </span>
            )}
            {httpUrlOrNull(profile?.social) && (
              <a
                href={httpUrlOrNull(profile?.social)!}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-gold hover:text-lime-hi"
              >
                {profile!.social!.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
              </a>
            )}
          </div>
        </div>

        {rank > 0 && (
          <div className="text-right">
            <div className="text-mist text-xs">Volume rank</div>
            <div className="font-display text-gold text-5xl leading-none">#{rank}</div>
          </div>
        )}
      </div>

      <ProfileEditor address={displayAddress} initial={profile} />

      {/* stats — every one of these is indexed, none are derived guesses. A
          profile-only wallet with no captain row reads 0/— across the board. */}
      <div
        className="mt-4 grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}
      >
        <Stat label="Coins created" value={String(captain?.coinsCreated ?? 0)} />
        <Stat label="Buys" value={String(captain?.buys ?? 0)} color="#7cc9a3" />
        <Stat label="Sells" value={String(captain?.sells ?? 0)} color="#de8092" />
        <Stat
          label="Volume"
          value={captain && captain.volumeNative > 0 ? fmtMc(captain.volumeUsd) : "—"}
          color="#8fb0e8"
        />
      </div>

      {/* coins created */}
      <section className="mt-8">
        <h2 className="font-display mb-3 text-xl">Coins created</h2>
        {!created || created.length === 0 ? (
          <p className="glass text-mist p-8 text-center text-sm">
            Nothing out of the shipyard yet.
          </p>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))" }}
          >
            {created.map((c) => (
              <Link
                key={c.address}
                href={`/token/${c.address}`}
                className="glass hover:border-lime flex items-center gap-3 p-3.5 transition-colors"
              >
                <CoinAvatar
                  image={c.image}
                  emoji={c.emoji}
                  name={c.name}
                  ticker={c.ticker}
                  size={40}
                  className="bg-deep rounded-chip"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{c.name}</span>
                  <span className="tabular text-mist text-xs">
                    ${c.ticker} · {fmtMc(c.marketCapUsd)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="glass p-3.5">
      <div className="text-mist text-xs">{label}</div>
      <div className="tabular mt-0.5 text-xl" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  )
}
