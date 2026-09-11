import { getLatestWeek, type RecordLine, type WeekRecord } from "@/lib/harbormaster"

/**
 * The public record: what the agent read, what it scored, and who is owed what.
 *
 * Renders nothing at all when no week has been scored, so the pitch above it is
 * the whole page until there is something true to show. An empty table with
 * hopeful headings would be worse than no table.
 *
 * Every number here is read straight from the agent's tables. This file never
 * computes a score or a share: if the page and the payout ever disagreed, the
 * page would be the thing people trusted and the chain would be the thing that
 * paid, which is exactly the gap the whole design exists to close.
 */

const CARD = "rounded-[14px] border border-[rgba(148,168,196,.16)] bg-[rgba(8,15,26,.6)]"
const PANEL =
  "relative rounded-[22px] border border-[rgba(148,168,196,.14)] bg-[rgba(13,24,39,.82)] p-[26px] shadow-[0_18px_40px_-24px_rgba(3,8,16,.72)] backdrop-blur-[8px]"

/** Base units to a readable decimal. No floats: these are uint256 amounts. */
function amount(raw: string, decimals: number): string {
  const v = BigInt(raw)
  const unit = 10n ** BigInt(decimals)
  const whole = (v / unit).toLocaleString("en-US")
  const frac = (v % unit).toString().padStart(decimals, "0").slice(0, 2)
  return `${whole}.${frac}`
}

function shortWallet(w: string): string {
  return `${w.slice(0, 6)}…${w.slice(-4)}`
}

function day(d: Date | null): string {
  if (!d) return "—"
  return d.toISOString().slice(0, 10)
}

/** Green when the lane was read, amber when a human has to look at it. */
function LaneBadge({ status }: { status: string }) {
  const tone =
    status === "ok"
      ? "border-[rgba(110,200,150,.45)] text-[#7fd6a6]"
      : status === "skipped"
        ? "border-[rgba(148,168,196,.35)] text-[#9db3d1]"
        : "border-[rgba(226,170,90,.5)] text-[#e0ac63]"
  return (
    <span className={`rounded-full border px-2.5 py-[3px] font-mono text-[11px] ${tone}`}>
      {status}
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
    <div className={`${CARD} flex gap-3 px-3.5 py-3`}>
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
          {line.wallet ? null : (
            <span className="rounded-full border border-[rgba(226,170,90,.45)] px-2 py-[2px] font-mono text-[10.5px] text-[#e0ac63]">
              no wallet · unpaid
            </span>
          )}
          {line.status === "excluded" ? (
            <span className="text-faint rounded-full border border-[rgba(148,168,196,.3)] px-2 py-[2px] font-mono text-[10.5px]">
              excluded
            </span>
          ) : null}
          {line.strippedBytes > 0 ? (
            <span
              className="text-faint font-mono text-[10.5px]"
              title="Hidden characters removed before the scorer read it"
            >
              {line.strippedBytes}B stripped
            </span>
          ) : null}
        </div>
        <div className="text-mist mt-1 text-[12.5px] leading-[1.5]">{line.reason}</div>
      </div>
    </div>
  )
}

export default async function Record() {
  let week: WeekRecord | null = null
  try {
    week = await getLatestWeek()
  } catch {
    // A record that cannot be read is not a reason to take the page down. The
    // pitch above still stands on its own.
    return null
  }
  if (!week || week.lines.length === 0) return null

  const coinTotal = week.payouts.reduce((s, p) => s + BigInt(p.coinAmount), 0n)
  const usdcTotal = week.payouts.reduce((s, p) => s + BigInt(p.usdcAmount), 0n)

  return (
    <section className={`${PANEL} mt-3`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-faint mb-1.5 font-mono text-[11px]" style={{ letterSpacing: ".16em" }}>
            <span className="text-primary">THE RECORD</span> · WEEK {week.epoch}
          </div>
          <div className="font-display text-[21px]">
            {day(week.windowStart)} to {day(week.windowEnd)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {week.lanes.map((l) => (
            <span key={l.lane} className="flex items-center gap-1.5">
              <span className="text-faint font-mono text-[11.5px]">{l.lane}</span>
              <LaneBadge status={l.status} />
            </span>
          ))}
          <span className="text-faint font-mono text-[11.5px]">· {week.state}</span>
        </div>
      </div>

      {week.lanes.some((l) => l.reason) ? (
        <div className="text-faint mt-2 font-mono text-[11.5px]">
          {week.lanes
            .filter((l) => l.reason)
            .map((l) => `${l.lane}: ${l.reason}`)
            .join(" · ")}
        </div>
      ) : null}

      {week.rules ? (
        <div className={`${CARD} mt-4 px-3.5 py-3`}>
          <div className="text-faint mb-1 font-mono text-[10.5px]" style={{ letterSpacing: ".14em" }}>
            THE RULES THIS WEEK WAS JUDGED BY
          </div>
          <div className="text-mist text-[12.5px] leading-[1.55]">{week.rules}</div>
        </div>
      ) : null}

      <div className="mt-5">
        <div className="text-faint mb-2 font-mono text-[11px]" style={{ letterSpacing: ".16em" }}>
          EVERY SCORE, AND WHY
        </div>
        <div className="flex flex-col gap-2">
          {week.lines.map((l, i) => (
            <Line key={`${l.link ?? l.handle}-${i}`} line={l} />
          ))}
        </div>
      </div>

      {week.payouts.length > 0 ? (
        <div className="mt-5">
          <div className="text-faint mb-2 font-mono text-[11px]" style={{ letterSpacing: ".16em" }}>
            WHO IS OWED WHAT
          </div>
          <div className="flex flex-col gap-1.5">
            {week.payouts.map((p) => (
              <div
                key={p.wallet}
                className={`${CARD} flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3.5 py-2.5`}
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
          <div className="text-faint mt-2 font-mono text-[11.5px]">
            {amount(coinTotal.toString(), 18)} tokens and {amount(usdcTotal.toString(), 6)} USDC
            across {week.payouts.length} wallet{week.payouts.length === 1 ? "" : "s"}
            {week.unpaidCount > 0
              ? ` · ${week.unpaidCount} author${week.unpaidCount === 1 ? "" : "s"} earned but has no wallet bound`
              : ""}
          </div>
        </div>
      ) : null}

      <div className="text-faint mt-5 border-t border-[rgba(148,168,196,.12)] pt-3 font-mono text-[11px] leading-[1.7]">
        {week.modelId ? <>scored by {week.modelId}</> : null}
        {week.promptHash ? <> · rules and prompt pinned at {week.promptHash.slice(0, 12)}</> : null}
        {week.publishedAt ? <> · posted {week.publishedAt.toISOString().slice(0, 16)}Z</> : null}
        <br />
        Every line above can be disputed while the clock runs. Nothing here has been paid out yet.
      </div>
    </section>
  )
}
