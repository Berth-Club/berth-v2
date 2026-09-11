import { getLatestWeek, type RecordLine, type WeekRecord } from "@/lib/harbormaster"

/**
 * The public record: what the agent read, what it scored, and who is owed what.
 *
 * Ordered outcome first. An earlier version opened with the date range and left
 * the numbers to the bottom, so the largest text on the card was the least
 * useful thing on it and a reader had to hunt for what actually happened. The
 * lead is now the count, the recipients and the pot; the window is metadata
 * beside them.
 *
 * One rhythm throughout: every section is a `Block`, so headings and gaps do
 * not drift apart as sections are added. Nothing is a card inside a card.
 *
 * Every number here is read straight from the agent's tables. This file never
 * computes a score or a share: if the page and the payout ever disagreed, the
 * page would be the thing people trusted and the chain would be the thing that
 * paid, which is exactly the gap the whole design exists to close.
 */

const PANEL =
  "relative rounded-[22px] border border-[rgba(148,168,196,.14)] bg-[rgba(13,24,39,.82)] p-[26px] shadow-[0_18px_40px_-24px_rgba(3,8,16,.72)] backdrop-blur-[8px]"
const ROW = "rounded-[14px] border border-[rgba(148,168,196,.16)] bg-[rgba(8,15,26,.6)]"
const LABEL = "text-faint font-mono text-[11px]"
const LABEL_SPACING = { letterSpacing: ".16em" } as const

/** Base units to a readable decimal. No floats: these are uint256 amounts. */
function amount(raw: string, decimals: number): string {
  const v = BigInt(raw)
  const unit = 10n ** BigInt(decimals)
  const whole = (v / unit).toLocaleString("en-US")
  const frac = (v % unit).toString().padStart(decimals, "0").slice(0, 2)
  return `${whole}.${frac}`
}

const shortWallet = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—")

/** One number and what it counts. The card's lead, so it reads before prose. */
function Stat({ value, label, dim }: { value: string; label: string; dim?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={`font-display text-[22px] leading-none ${dim ? "text-mist" : "text-foam"}`}>
        {value}
      </div>
      <div className={`${LABEL} mt-1.5`} style={LABEL_SPACING}>
        {label}
      </div>
    </div>
  )
}

/** Green when the lane was read, amber when a human has to look at it. */
function LaneBadge({ lane, status }: { lane: string; status: string }) {
  const tone =
    status === "ok"
      ? "border-[rgba(110,200,150,.45)] text-[#7fd6a6]"
      : status === "skipped"
        ? "border-[rgba(148,168,196,.35)] text-[#9db3d1]"
        : "border-[rgba(226,170,90,.5)] text-[#e0ac63]"
  return (
    <span className={`rounded-full border px-2.5 py-[3px] font-mono text-[11px] ${tone}`}>
      {lane} · {status}
    </span>
  )
}

function ScoreDot({ score }: { score: number }) {
  const tone = score >= 70 ? "#7fd6a6" : score >= 35 ? "#89a7db" : "#6b7f9c"
  return (
    <div
      className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] border font-mono text-[14px] font-semibold"
      style={{ borderColor: `${tone}55`, color: tone, background: `${tone}12` }}
    >
      {score}
    </div>
  )
}

function Line({ line }: { line: RecordLine }) {
  return (
    <div className={`${ROW} flex gap-3 px-3.5 py-3`}>
      <ScoreDot score={line.score} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-foam text-[13px] font-semibold">{line.handle ?? "unknown"}</span>
          {line.link ? (
            <a
              href={line.link}
              target="_blank"
              rel="noreferrer noopener"
              className="text-faint hover:text-body2 font-mono text-[11px] underline underline-offset-2"
            >
              the work ↗
            </a>
          ) : null}
          {line.status === "excluded" ? (
            <span className="text-faint rounded-full border border-[rgba(148,168,196,.3)] px-2 py-[2px] font-mono text-[10.5px]">
              excluded
            </span>
          ) : null}
        </div>
        <div className="text-mist mt-1 text-[12.5px] leading-[1.5]">{line.reason}</div>
      </div>
    </div>
  )
}

/** A heading and its content, at one rhythm throughout the card. */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <div className={`${LABEL} mb-2.5`} style={LABEL_SPACING}>
        {title}
      </div>
      {children}
    </div>
  )
}

export default async function Record() {
  let week: WeekRecord | null = null
  try {
    week = await getLatestWeek()
  } catch {
    // A record that cannot be read is not a reason to take the page down. The
    // rest of the page still stands on its own.
    return null
  }
  if (!week || (week.lines.length === 0 && week.unlistedCount === 0)) return null

  const coinTotal = week.payouts.reduce((s, p) => s + BigInt(p.coinAmount), 0n)
  const usdcTotal = week.payouts.reduce((s, p) => s + BigInt(p.usdcAmount), 0n)
  const judged = week.lines.length + week.unlistedCount
  const nobodyPayable = week.payouts.length === 0

  return (
    <section className={`${PANEL} mt-3`}>
      {/* Outcome first, window second. What happened outranks when. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className={`${LABEL} mb-3`} style={LABEL_SPACING}>
            <span className="text-primary">THE RECORD</span> · WEEK {week.epoch} ·{" "}
            {day(week.windowStart)} to {day(week.windowEnd)}
          </div>
          <div className="flex flex-wrap items-start gap-x-9 gap-y-4">
            <Stat value={String(judged)} label="JUDGED" />
            <Stat value={String(week.payouts.length)} label="WALLETS OWED" dim={nobodyPayable} />
            <Stat value={amount(coinTotal.toString(), 18)} label="TOKENS" dim={coinTotal === 0n} />
            <Stat value={amount(usdcTotal.toString(), 6)} label="USDC" dim={usdcTotal === 0n} />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {week.lanes.map((l) => (
            <LaneBadge key={l.lane} lane={l.lane} status={l.status} />
          ))}
          <span className={LABEL}>{week.state}</span>
        </div>
      </div>

      {week.lanes.some((l) => l.reason) ? (
        <div className={`${LABEL} mt-3 leading-[1.6]`}>
          {week.lanes
            .filter((l) => l.reason)
            .map((l) => `${l.lane}: ${l.reason}`)
            .join(" · ")}
        </div>
      ) : null}

      {week.rules ? (
        <Block title="JUDGED BY THESE RULES">
          <div className="text-mist text-[12.5px] leading-[1.6]">{week.rules}</div>
        </Block>
      ) : null}

      {week.lines.length > 0 ? (
        <Block title="EVERY SCORE, AND WHY">
          <div className="flex flex-col gap-2">
            {week.lines.map((l, i) => (
              <Line key={`${l.link ?? l.handle}-${i}`} line={l} />
            ))}
          </div>
        </Block>
      ) : null}

      {week.inFlight.length > 0 ? (
        <Block title="IN FLIGHT">
          <div className="flex flex-col gap-1.5">
            {week.inFlight.map((l, i) => (
              <div
                key={`${l.link ?? l.handle}-${i}`}
                className={`${ROW} flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5`}
              >
                <span className="text-foam text-[13px] font-semibold">
                  {l.handle ?? "unknown"}
                </span>
                {l.link ? (
                  <a
                    href={l.link}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-faint hover:text-body2 min-w-0 flex-1 truncate font-mono text-[11.5px] underline underline-offset-2"
                  >
                    {l.reason !== "Not yet judged." ? l.reason : l.link}
                  </a>
                ) : null}
                <span className="text-faint shrink-0 font-mono text-[11px]">
                  {l.wallet ? "wallet ready" : "no wallet yet"}
                </span>
              </div>
            ))}
          </div>
          <div className="text-faint mt-2 text-[12px] leading-[1.6]">
            Open work, seen but not judged. A pull request is scored when it merges, because
            one that is closed without merging was never work anyone can be paid for.
          </div>
        </Block>
      ) : null}

      {week.payouts.length > 0 ? (
        <Block title="WHO IS OWED WHAT">
          <div className="flex flex-col gap-1.5">
            {week.payouts.map((p) => (
              <div
                key={p.wallet}
                className={`${ROW} flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3.5 py-2.5`}
              >
                <span className="text-body2 font-mono text-[12px]">{shortWallet(p.wallet)}</span>
                <span className="text-foam font-mono text-[12.5px]">
                  {amount(p.coinAmount, 18)} <span className="text-faint">tokens</span>
                  <span className="text-faint mx-2">·</span>
                  {amount(p.usdcAmount, 6)} <span className="text-faint">USDC</span>
                </span>
              </div>
            ))}
          </div>
        </Block>
      ) : null}

      {week.unlistedCount > 0 ? (
        <Block title={nobodyPayable ? "NOBODY IS OWED ANYTHING YET" : "NOT LISTED"}>
          <div className="text-mist text-[12.5px] leading-[1.6]">
            {week.unlistedCount} contribution{week.unlistedCount === 1 ? " was" : "s were"} judged
            but {week.unlistedCount === 1 ? "its author has" : "their authors have"} no wallet
            address on record, so nothing is owed.
          </div>
          <div className="text-faint mt-2 text-[12.5px] leading-[1.6]">
            Put your wallet address in the description of your pull request and the agent picks it
            up. The first address an account uses is kept for good, so a later edit cannot move
            where your pay goes.
          </div>
        </Block>
      ) : null}

      <div className={`${LABEL} mt-6 border-t border-[rgba(148,168,196,.12)] pt-4 leading-[1.7]`}>
        {week.modelId ? <>scored by {week.modelId}</> : null}
        {week.promptHash ? <> · rules and prompt pinned at {week.promptHash.slice(0, 12)}</> : null}
        {week.publishedAt ? <> · posted {week.publishedAt.toISOString().slice(0, 16)}Z</> : null}
        <br />
        Every score can be disputed while the clock runs. Nothing here has been paid out yet.
      </div>
    </section>
  )
}
