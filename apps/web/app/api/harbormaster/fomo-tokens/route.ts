import { NextResponse } from "next/server"

import { listFomoTokens } from "@/lib/harbormaster"

/**
 * Which tokens the callout bot should watch.
 *
 * The bot used to take this list from an environment variable, which meant a
 * launch only started earning callouts once someone remembered to edit a
 * Railway variable and redeploy. Worse, it split the truth in two: a coin's
 * FOMO tokens are already configured in its Harbormaster rules, so the copy in
 * the bot could drift, and the failure was silent because callouts simply
 * stopped being counted.
 *
 * So the rules are the source of truth and the bot reads them here. A launch
 * turns its own venue on.
 *
 * Public and read-only on purpose. Every value in the response is a token
 * contract address, which is already public the moment the coin exists, and
 * making the bot hold a credential to read public addresses would be a secret
 * to rotate for no benefit.
 */

// The bot polls this on a timer, so a short cache spares the database without
// making a new launch wait noticeably. It is re-read well within one sweep.
export const revalidate = 60

export async function GET() {
  try {
    const tokens = await listFomoTokens()
    return NextResponse.json(
      { tokens, count: tokens.length },
      // Explicit, because the bot's failure mode for a stale list is a coin
      // that silently earns nothing.
      { headers: { "cache-control": "public, max-age=60" } }
    )
  } catch {
    // A reader that cannot reach the database must not be handed an empty list:
    // the bot would read it as "watch nothing" and stop archiving every coin at
    // once. A 503 makes it keep the list it already has.
    return NextResponse.json(
      { error: "the rules could not be read" },
      { status: 503 }
    )
  }
}
