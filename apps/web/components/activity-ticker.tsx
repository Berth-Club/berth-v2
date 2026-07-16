// Ticker tape under the header: 13px items separated by 1px dashed hairlines,
// content duplicated 2× in a max-content row, translateX(-50%) ~35s loop.
// Wired to live buy/launch events later (plan Unit 2).
const MOCK_FEED = [
  "🟢 0x3f2…a91 loaded 0.42 Ξ into $FLAG",
  "🚢 $BAIT left the shipyard",
  "🟢 0x624…4e895 loaded 0.09 Ξ into $CHOMP",
  "🎓 $FLAG graduated — 41.2K MC",
  "🔴 0x77e…12af cashed out 0.15 Ξ of $COMPASS",
  "🚢 $HPEPE left the shipyard",
  "🟢 0x4a6…d34e2 loaded 1.10 Ξ into $CRAB",
  "🟢 0x9a1…b3c2 loaded 0.30 Ξ into $FIRE",
]

export function ActivityTicker() {
  return (
    <div className="bg-deep overflow-hidden">
      <div className="animate-tape flex w-max">
        {[...MOCK_FEED, ...MOCK_FEED].map((item, i) => (
          <span
            key={i}
            className="text-body2 whitespace-nowrap px-[26px] py-[7px] text-[13px] font-medium"
            style={{ borderRight: "1px dashed #22331f" }}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}
