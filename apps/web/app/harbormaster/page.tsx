import type { Metadata } from "next"
import Link from "next/link"

import Record from "./record"

export const metadata: Metadata = {
  title: "The Harbormaster — berth.club",
  description:
    "An agent that pays for work, not for waiting. Half of every launch supply settles weekly to the people shipping code, posts and callouts.",
}

const GITHUB = "https://github.com/Berth-Club"

/* ── shared bits ─────────────────────────────────────────────── */

const CARD = "rounded-[14px] border border-[rgba(148,168,196,.16)] bg-[rgba(8,15,26,.6)]"
const PANEL =
  "relative rounded-[22px] border border-[rgba(148,168,196,.14)] bg-[rgba(13,24,39,.82)] p-[26px] shadow-[0_18px_40px_-24px_rgba(3,8,16,.72)] backdrop-blur-[8px]"

function Kicker({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="text-faint mb-1.5 font-mono text-[11px]" style={{ letterSpacing: ".16em" }}>
      <span className="text-primary">{n}</span> · {children}
    </div>
  )
}

function Tile({ title, note }: { title: string; note: string }) {
  return (
    <div className={`${CARD} px-[11px] py-[9px]`}>
      <div className="text-[13px] font-semibold">{title}</div>
      <div className="text-faint mt-[3px] text-[11.5px]">{note}</div>
    </div>
  )
}

/** The connector slot that is deliberately not filled in yet. */
function OpenTile() {
  return (
    <div className="rounded-[14px] border-[1.5px] border-dashed border-[rgba(148,168,196,.3)] px-[11px] py-[9px]">
      <div className="text-faint text-[13px] font-semibold">your connector</div>
      <div className="mt-[3px] text-[11.5px] text-[#51637f]">the spec is open</div>
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[rgba(137,167,219,.45)] px-3 py-1 text-[11.5px] font-semibold text-[#a9c1ec]">
      {children}
    </span>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-body2 rounded-[7px] border border-[rgba(148,168,196,.22)] bg-[#0e1f35] px-[11px] py-1 font-mono text-[11.5px]">
      {children}
    </span>
  )
}

/** Between-layer connector: a short arrow pointing down the flow. */
function DownArrow() {
  return (
    <div className="my-px flex justify-center" aria-hidden>
      <svg width="60" height="18" viewBox="0 0 60 18">
        <path d="M30 1 V10 M25 7 L30 12 L35 7" fill="none" stroke="#89a7db" strokeWidth="1.6" />
      </svg>
    </div>
  )
}

/** The loop rail's riser, drawn between rungs and stretched by flex. */
function UpArrow() {
  return (
    <div className="flex min-h-[26px] flex-1 items-center justify-center" aria-hidden>
      <svg width="40" height="26" viewBox="0 0 40 26">
        <path d="M20 24 V7 M15 11 L20 5 L25 11" fill="none" stroke="#89a7db" strokeWidth="1.5" />
      </svg>
    </div>
  )
}

function Rung({ title, note, lit = false }: { title: string; note: string; lit?: boolean }) {
  return (
    <div
      className={
        lit
          ? "rounded-xl border border-[rgba(137,167,219,.55)] bg-[rgba(137,167,219,.07)] px-3 py-[9px]"
          : "rounded-xl border border-[rgba(148,168,196,.16)] bg-[rgba(8,15,26,.6)] px-3 py-[9px]"
      }
    >
      <div className="text-foam text-[12.5px] font-semibold">{title}</div>
      <div className="text-faint mt-[3px] text-[11.5px]">{note}</div>
    </div>
  )
}

function GitHubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 1.8a10.2 10.2 0 0 0-3.22 19.88c.51.09.7-.22.7-.49v-1.72c-2.84.62-3.44-1.37-3.44-1.37-.46-1.18-1.13-1.5-1.13-1.5-.93-.63.07-.62.07-.62 1.02.07 1.56 1.05 1.56 1.05.91 1.56 2.39 1.11 2.97.85.09-.66.36-1.11.65-1.37-2.27-.26-4.65-1.13-4.65-5.04 0-1.11.4-2.02 1.05-2.74-.11-.26-.46-1.3.1-2.7 0 0 .86-.28 2.8 1.05a9.7 9.7 0 0 1 5.1 0c1.94-1.33 2.8-1.05 2.8-1.05.56 1.4.21 2.44.1 2.7.65.72 1.05 1.63 1.05 2.74 0 3.92-2.39 4.78-4.66 5.03.37.32.69.94.69 1.9v2.82c0 .27.19.59.71.49A10.2 10.2 0 0 0 12 1.8z" />
    </svg>
  )
}

/* ── page ────────────────────────────────────────────────────── */

export default async function HarbormasterPage() {
  return (
    <div className="relative z-[1] mx-auto max-w-[1000px] px-5 pb-15 pt-6">
      <section className="my-[10px] mb-[26px] max-w-[720px]">
        <div
          className="text-primary mb-3.5 inline-flex items-center gap-2 rounded-full border border-[rgba(137,167,219,.4)] px-[13px] py-1.5 text-[11px] font-semibold"
          style={{ letterSpacing: ".18em" }}
        >
          <span className="bg-primary size-1.5 animate-pulse rounded-full" />
          COMING SOON
        </div>

        <h1 className="font-display text-[clamp(30px,4vw,42px)] leading-[1.12]">
          The sea pays no one for waiting.
        </h1>

        <p className="text-mist mt-3.5 text-[15px] leading-[1.7] text-pretty">
          Bags do not earn. Work does. Every token launched here trusts half its supply to the
          Harbormaster, an agent that cannot be lobbied, only shown receipts: a merged commit, a
          timestamped callout, a video that filled the deck. Once a week it settles what it owes, in
          the token and in USDC, with a public reason for every yes and every no. The other half
          never leaves the water. No team wallet, no admin key, nothing to beg for.
        </p>

        <div className="mt-5 flex flex-wrap gap-2.5">
          <a
            href={GITHUB}
            target="_blank"
            rel="noreferrer noopener"
            className="btn-glossy inline-flex items-center gap-[9px] px-[22px] py-3 text-[14.5px]"
          >
            <GitHubMark />
            Contribute on GitHub, earn rewards
          </a>
          <Link href="/docs" className="btn-frost text-body2 hover:text-foam px-5 py-3 text-[14px] font-semibold">
            Read the docs
          </Link>
        </div>
      </section>

      {/* The record sits above the explanation: once a week has been scored,
          what actually happened matters more than how it is meant to work.
          Renders nothing until there is a scored week. */}
      <Record />

      <section className={PANEL}>
        <div className="text-faint text-[11px] font-semibold" style={{ letterSpacing: ".12em" }}>
          HOW IT WORKS
        </div>

        <div className="mt-4 grid items-stretch gap-[26px] lg:grid-cols-[minmax(0,1fr)_220px]">
          {/* the seven layers, top to bottom */}
          <div>
            <Kicker n="01">PEOPLE SAIL IN</Kicker>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-[7px]">
              <Tile title="Builders" note="come for the weekly pay" />
              <Tile title="Creators" note="come for reach that pays" />
              <Tile title="Traders" note="come for coins with crews" />
              <Tile title="Apps" note="come to airdrop through the agent" />
            </div>

            <DownArrow />
            <Kicker n="02">THE WORK HAPPENS</Kicker>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-[7px]">
              <Tile title="GitHub" note="merged code" />
              <Tile title="X" note="posts + articles" />
              <Tile title="pump.fun" note="in-app callouts" />
              <Tile title="FOMO" note="in-feed callouts" />
              <OpenTile />
            </div>

            <DownArrow />
            <Kicker n="03">CONNECTORS</Kicker>
            <div
              className={`${CARD} flex flex-wrap items-baseline justify-between gap-3 px-3.5 py-2.5`}
            >
              <div className="text-[13px] font-semibold">Every lane speaks one language</div>
              <div className="text-faint font-mono text-[11.5px]">
                open connector spec · one standard event format
              </div>
            </div>

            <DownArrow />
            <Kicker n="04">THE AGENT SCORES IT</Kicker>
            <div className="rounded-[14px] border border-[rgba(137,167,219,.5)] bg-[rgba(137,167,219,.06)] px-3.5 py-[11px]">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="text-[13.5px] font-semibold">The Harbormaster</div>
                <Pill>public rubric</Pill>
                <Pill>Sybil defense</Pill>
              </div>
              <div className="text-faint mt-1.5 text-[12px]">
                every verdict ships with a written reason, posted where the work happened · the full
                payout list goes up 48h before it settles, and anyone can challenge a score
              </div>
            </div>

            <DownArrow />
            <Kicker n="05">THE VAULT, ONCHAIN</Kicker>
            <div className={`${CARD} px-3.5 py-[11px]`}>
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="text-[13.5px] font-semibold">Half of every launch supply</div>
                <Chip>1% per epoch cap</Chip>
                <Chip>merkle claims, expiry</Chip>
              </div>
              <div className="text-faint mt-2 font-mono text-[12px]">
                no admin key · the other half locks in the pool forever · settles near 50 weeks of
                buyback depth
              </div>
            </div>

            <DownArrow />
            <Kicker n="06">THE PAYOUT, EVERY WEEK</Kicker>
            <div className="grid grid-cols-2 gap-[7px]">
              <Tile title="In the token" note="a fixed slice of the vault" />
              <Tile title="In USDC" note="from fees the work earned" />
            </div>
            <div className="mt-2.5">
              <Pill>public receipt, replied in-platform</Pill>
            </div>

            <DownArrow />
            <Kicker n="07">THE PROTOCOL EARNS</Kicker>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-[7px]">
              <Tile title="Trading fees" note="the 1% hook on every swap" />
              <Tile title="Launch fees" note="every new launch pays in" />
              <Tile title="x402 reviews" note="outside projects pay per score" />
              <Tile title="Airdrop fees" note="a cut of every distribution" />
            </div>
            <div className="text-primary mt-2.5 flex items-center gap-2 text-[11.5px] font-semibold">
              every stream flows into the loop
              <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden>
                <path d="M2 6 H20 M15 1 L21 6 L15 11" fill="none" stroke="#89a7db" strokeWidth="1.6" />
              </svg>
            </div>
          </div>

          {/* the demand rail, read bottom to top */}
          <div className="flex flex-col">
            <div className="text-faint mb-1.5 font-mono text-[11px]" style={{ letterSpacing: ".16em" }}>
              THE LOOP
            </div>
            <div className="relative flex flex-1 flex-col justify-between gap-1 rounded-[14px] border-[1.5px] border-dashed border-[rgba(137,167,219,.3)] px-3 py-3.5">
              <div className="absolute -left-[23px] top-[38px] hidden lg:block" aria-hidden>
                <svg width="24" height="16" viewBox="0 0 24 16">
                  <path d="M22 8 H6 M11 3 L5 8 L11 13" fill="none" stroke="#89a7db" strokeWidth="1.5" />
                </svg>
              </div>
              <div className="text-faint mb-1.5 text-[11.5px] leading-[1.55]">
                reads bottom to top: nothing here is charity, the vault funds the work that funds the
                vault
              </div>
              <Rung lit title="the vault refills" note="what it paid for comes back as revenue" />
              <UpArrow />
              <Rung title="the protocol collects" note="fees from launches, reviews and airdrops" />
              <UpArrow />
              <Rung title="the crowd becomes volume" note="every trade pays the 1% hook" />
              <UpArrow />
              <Rung title="work draws a crowd" note="a merged fix, a good post, a loud callout" />
            </div>
          </div>
        </div>
      </section>

      <section className={`${PANEL} mt-3 flex flex-wrap items-center justify-between gap-4`}>
        <div className="min-w-0">
          <div className="font-display text-[19px]">
            The launch supply is the starter motor. The work is the engine.
          </div>
          <div className="text-mist mt-1.5 text-[13px]">
            Ship before mainnet and the first epoch remembers you. The agent scores it retroactively.
          </div>
        </div>
        <a
          href={GITHUB}
          target="_blank"
          rel="noreferrer noopener"
          className="btn-frost text-body2 hover:text-foam shrink-0 px-5 py-3 text-[14px] font-semibold"
        >
          github.com/Berth-Club →
        </a>
      </section>
    </div>
  )
}
