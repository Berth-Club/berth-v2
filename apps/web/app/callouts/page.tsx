import type { Metadata } from "next"

import Callouts from "./callouts"

export const metadata: Metadata = {
  title: "Live callouts — berth.club",
  description: "FOMO callouts on the tokens berth.club watches, collected as they are posted.",
}

/**
 * Re-rendered at most once a minute, never frozen at build time. The build
 * container cannot reach the private database, so a static render would ship an
 * empty page for good.
 */
export const revalidate = 60

export default function CalloutsPage() {
  return (
    <div className="relative z-[1] mx-auto max-w-[1000px] px-5 pb-15 pt-6">
      <Callouts />
    </div>
  )
}
