import { getLatestWeek } from "@/lib/harbormaster"

/**
 * What the Harbormaster is actually doing right now.
 *
 * This replaces a hard-coded "COMING SOON" that outlived the thing it
 * described: the page went on claiming nothing existed for as long as nobody
 * remembered to edit it. Reading the record means the label cannot drift from
 * reality again, in either direction.
 *
 * It is careful not to overclaim. Scoring a week and paying for one are
 * different things, and until a payout has actually settled the pill says so.
 */
export default async function StatusPill() {
  let week = null
  try {
    week = await getLatestWeek()
  } catch {
    week = null
  }

  const [label, live] = !week
    ? ["COMING SOON", false]
    : week.payouts.length === 0
      ? [`WEEK ${week.epoch} SCORED`, true]
      : week.state === "root_posted" || week.state === "settled"
        ? [`WEEK ${week.epoch} PAID`, true]
        : [`WEEK ${week.epoch} PUBLISHED · NOT YET PAID`, true]

  return (
    <div
      className="text-primary mb-3.5 inline-flex items-center gap-2 rounded-full border border-[rgba(137,167,219,.4)] px-[13px] py-1.5 text-[11px] font-semibold"
      style={{ letterSpacing: ".18em" }}
    >
      <span
        className={`size-1.5 rounded-full ${live ? "bg-primary animate-pulse" : "bg-primary"}`}
      />
      {label}
    </div>
  )
}
