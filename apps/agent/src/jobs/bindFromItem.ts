import { hmBindings, hmWalletClaims } from "@workspace/db"
import { and, eq } from "drizzle-orm"

import { checkPayoutAddress, findPayoutAddress, rejectionReason } from "../connectors/address.js"
import type { JobContext } from "./types.js"

/**
 * Bind a contributor's wallet from an address they wrote in their own work.
 *
 * The rule is first mention wins, permanently. The first address a GitHub
 * account ever writes becomes its payout address for good; every later mention
 * of a different one is recorded and ignored.
 *
 * That rule is doing real work, not tidiness. A pull request body can be edited
 * by anyone with write access to the repository, not only its author, so on a
 * coin whose creator is a maintainer the creator could otherwise rewrite a
 * contributor's address to their own and collect their work. Locking on first
 * sight means that attack has exactly one chance per contributor, on their
 * first pull request, before anyone has a reason to try it, instead of a fresh
 * chance every week forever.
 *
 * The cost is that a genuine change of wallet needs an operator. That is the
 * right way round: losing a wallet is rare and recoverable by asking, while
 * silently redirecting someone's pay is neither.
 *
 * Some venues hand us the address instead. FOMO keeps a custodial wallet per
 * account and will return it for any user id, which is what lets a four-word
 * market callout be paid at all. That case takes `platformWallet` and skips the
 * scraping; every rule after it, the gate, first-mention-wins, the unique index
 * that stops one wallet earning for two accounts, is exactly the same. The one
 * asymmetry is deliberate: an address the platform holds cannot be edited by a
 * coin's maintainer, so the attack first-mention-wins exists to stop does not
 * apply to it.
 */

export interface BindOutcome {
  status: string
  wallet: string | null
  note: string
}

export async function bindFromItem(
  ctx: JobContext,
  item: {
    id: bigint
    platform: string
    platformUserId: string
    platformHandle: string | null
    content: string | null
    /**
     * An address the PLATFORM holds for this author, if the venue has one.
     * Takes precedence over the content, because a field from the platform is
     * not attacker-editable and a description is.
     */
    platformWallet?: string | null
    coin: string
    epoch: number
  }
): Promise<BindOutcome> {
  const { db } = ctx
  // Run against the CLEANED content. An address hidden in an HTML comment, or
  // split by zero-width characters so it reads one way to a human and another
  // to a parser, is defeated by hygiene running first.
  const found = item.platformWallet
    ? checkPayoutAddress(item.platformWallet)
    : findPayoutAddress(item.content)

  const record = async (status: string, wallet: string | null, note: string) => {
    await db
      .insert(hmWalletClaims)
      .values({
        platform: item.platform,
        subject: item.platformUserId,
        wallet,
        itemId: item.id,
        coin: item.coin,
        epoch: item.epoch,
        status,
        note,
      })
      // One claim row per item, so a venue re-read converges instead of piling up.
      .onConflictDoNothing()
    return { status, wallet, note }
  }

  if (!found.address) {
    if (found.rejected === "none_found") {
      // Not worth a row. Most pull requests never mention an address, and most
      // callout authors have not been looked up yet; recording every one of
      // those would bury the claims that matter.
      return { status: "none_found", wallet: null, note: "" }
    }
    return record(
      found.rejected === "bad_checksum"
        ? "rejected_checksum"
        : found.rejected === "several_found"
          ? "rejected_several"
          : "rejected_unpayable",
      null,
      rejectionReason(found.rejected!, found.seen)
    )
  }

  const wallet = found.address

  const [existing] = await db
    .select({ wallet: hmBindings.wallet })
    .from(hmBindings)
    .where(and(eq(hmBindings.platform, item.platform), eq(hmBindings.subject, item.platformUserId)))

  if (existing) {
    if (existing.wallet === wallet) {
      return record("already_bound_same", wallet, "Same address as the one already bound.")
    }
    return record(
      "ignored_locked",
      wallet,
      `This account is already bound to ${existing.wallet}. The first address an account ` +
        `uses is permanent, so ${wallet} was not used. An operator can change it.`
    )
  }

  // The insert is the lock. Two pull requests read in the same batch, or two
  // workers racing, both reach here and the unique index decides; whichever
  // loses reads back the winner rather than overwriting it.
  const inserted = await db
    .insert(hmBindings)
    .values({
      platform: item.platform,
      subject: item.platformUserId,
      handle: item.platformHandle,
      wallet,
    })
    .onConflictDoNothing()
    .returning({ wallet: hmBindings.wallet })

  if (inserted.length > 0) {
    return record("bound", wallet, `Bound to ${wallet} from this contribution.`)
  }

  // Lost the insert. Either this account was bound a moment ago, or the wallet
  // itself is already claimed by a different account, which the second unique
  // index forbids: one wallet per platform is what stops one person collecting
  // for several accounts.
  const [now] = await db
    .select({ wallet: hmBindings.wallet })
    .from(hmBindings)
    .where(and(eq(hmBindings.platform, item.platform), eq(hmBindings.subject, item.platformUserId)))

  if (now?.wallet === wallet) {
    return record("already_bound_same", wallet, "Bound by a contribution read moments earlier.")
  }
  if (now) {
    return record("ignored_locked", wallet, `This account is already bound to ${now.wallet}.`)
  }
  return record(
    "wallet_taken",
    wallet,
    `${wallet} is already bound to a different account. One wallet earns for one account.`
  )
}
