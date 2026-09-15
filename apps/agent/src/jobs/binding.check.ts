import assert from "node:assert/strict"

import {
  assertThrowaway,
  hmBindings,
  hmEpochs,
  hmItems,
  hmRuleVersions,
  hmWalletClaims,
  makeDb,
  TRUNCATABLE_TABLE_NAMES,
} from "@workspace/db"
import { and, eq, sql } from "drizzle-orm"

import { epochBounds, lastClosedEpoch } from "../clock.js"
import { venueRead } from "./venueRead.js"
import type { JobContext } from "./types.js"

/**
 * Binding a wallet from what a contributor wrote, against a real database.
 *
 * The rule under test is first mention wins, permanently, and the case that
 * matters is the attack it exists for: a pull request body can be edited by
 * anyone with write access to the repository, so a maintainer could otherwise
 * rewrite a contributor's address to their own and collect their work.
 *
 *   pnpm --filter agent check:binding
 */

const COIN = "0x00000000000000000000000000000000000000bb"
const ALICE = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
const ALICE_LOWER = ALICE.toLowerCase()
const THIEF = "0x388C818CA8B9251b393131C08a736A67ccB19297"
const THIEF_LOWER = THIEF.toLowerCase()

assertThrowaway(process.env.DATABASE_URL)

const db = makeDb(process.env.DATABASE_URL)
if (!db) {
  console.error("DATABASE_URL is not set. Point it at a throwaway database.")
  process.exit(1)
}

const EPOCH = lastClosedEpoch()!
const { start, end } = epochBounds(EPOCH)
const MERGED = new Date(start.getTime() + 3600_000).toISOString()

let n = 0
function pull(body: string, userId = 1001, login = "alice", nodeId?: string) {
  n++
  return {
    number: n,
    node_id: nodeId ?? `PR_${n}`,
    title: `Change ${n}`,
    body,
    html_url: `https://github.com/acme/app/pull/${n}`,
    merged_at: MERGED,
    updated_at: MERGED,
    user: { id: userId, login },
  }
}

function serve(pages: unknown[][]) {
  return (async (url: string) => {
    // The reader asks twice: once for closed pull requests, once for open
    // ones. Serving the same page to both returned every pull request twice,
    // which is the fixture lying rather than the reader misbehaving.
    if (/[?&]state=open/.test(String(url))) return Response.json([])
    const page = Number(/[?&]page=(\d+)/.exec(String(url))?.[1] ?? 1)
    return Response.json(pages[page - 1] ?? [])
  }) as unknown as typeof fetch
}

async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const saved = globalThis.fetch
  globalThis.fetch = impl
  try {
    return await fn()
  } finally {
    globalThis.fetch = saved
  }
}

const ctx = (): JobContext => ({
  db: db!,
  workerId: "binding-check",
  job: { id: 1n, type: "venue_read", coin: COIN, epoch: EPOCH, key: "github", attempts: 0, payload: null },
})

async function reset() {
  await db!.execute(
    sql.raw(`truncate ${TRUNCATABLE_TABLE_NAMES.join(", ")} cascade`)
  )
  const [v] = await db!
    .insert(hmRuleVersions)
    .values({
      coin: COIN,
      versionNo: 1,
      body: "merged code counts",
      sources: { github: [{ repoId: 10, name: "acme/app" }] },
      effectiveFromEpoch: EPOCH,
      confirmedAt: new Date(),
    })
    .returning({ id: hmRuleVersions.id })
  await db!.insert(hmEpochs).values({
    coin: COIN,
    epoch: EPOCH,
    state: "reads_pending",
    rulesVersionId: v!.id,
    windowStart: start,
    windowEnd: end,
  })
}

const bindingOf = async (subject: string) => {
  const [row] = await db!
    .select({ wallet: hmBindings.wallet })
    .from(hmBindings)
    .where(and(eq(hmBindings.platform, "github"), eq(hmBindings.subject, subject)))
  return row?.wallet ?? null
}

const claims = async () =>
  db!.select().from(hmWalletClaims).orderBy(hmWalletClaims.id)

async function main() {
  assert.ok(process.env.GITHUB_TOKEN, "run through `pnpm --filter agent check:binding`")

  /* ── an address in the body binds the author ────────────────────────────── */

  await reset()
  await withFetch(serve([[pull(`Fixes the rounding bug.\n\nPayout: ${ALICE}`)]]), async () => {
    await venueRead(ctx())
  })
  assert.equal(await bindingOf("1001"), ALICE_LOWER, "the address they wrote is bound to them")
  const first = await claims()
  assert.equal(first.length, 1)
  assert.equal(first[0]!.status, "bound")
  assert.ok(first[0]!.itemId, "and the claim points at the contribution it came from")

  /* ── the attack: someone edits the body to a different address ──────────── */

  await withFetch(
    // Same pull request id, body now naming the thief. A maintainer can do
    // this to anyone's description at any time, including after the merge.
    serve([[pull(`Fixes the rounding bug.\n\nPayout: ${THIEF}`, 1001, "alice", "PR_1")]]),
    async () => {
      await venueRead(ctx())
    }
  )
  assert.equal(
    await bindingOf("1001"),
    ALICE_LOWER,
    "the binding does not move: this is the whole reason first mention wins"
  )
  const afterEdit = await claims()
  const ignored = afterEdit.find((c) => c.status === "ignored_locked")
  assert.ok(ignored, "and the attempt is recorded rather than silently dropped")
  assert.equal(ignored!.wallet, THIEF_LOWER, "with the address that was refused")
  assert.match(ignored!.note!, /already bound/, "and a sentence a person can read")

  /* ── a later pull request repeating the same address is not a conflict ──── */

  await withFetch(serve([[pull(`More work. ${ALICE}`, 1001, "alice", "PR_SECOND")]]), async () => {
    await venueRead(ctx())
  })
  assert.equal(await bindingOf("1001"), ALICE_LOWER)
  assert.ok(
    (await claims()).some((c) => c.status === "already_bound_same"),
    "repeating your own address is normal, not an attempt"
  )

  /* ── one wallet cannot earn for two accounts ────────────────────────────── */

  await withFetch(
    serve([[pull(`Me too. ${ALICE}`, 2002, "sockpuppet", "PR_SOCK")]]),
    async () => {
      await venueRead(ctx())
    }
  )
  assert.equal(await bindingOf("2002"), null, "the second account gets no binding")
  const taken = (await claims()).find((c) => c.status === "wallet_taken")
  assert.ok(taken, "and is told why")
  assert.match(taken!.note!, /one account/i)

  /* ── a bad checksum is refused and explained, never paid ────────────────── */

  await reset()
  const typo = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96046"
  await withFetch(serve([[pull(`Pay me at ${typo}`, 3003, "careless")]]), async () => {
    await venueRead(ctx())
  })
  assert.equal(await bindingOf("3003"), null, "one wrong character binds nothing")
  const rejected = (await claims()).find((c) => c.status === "rejected_checksum")
  assert.ok(rejected, "the failure is on the record")
  assert.match(rejected!.note!, /checksum/, "so the contributor can fix it")

  /* ── an address hidden in a comment never binds ─────────────────────────── */

  await reset()
  await withFetch(
    serve([[pull(`Real work here.\n<!-- ${THIEF} -->\nPayout: ${ALICE}`, 4004, "alice2")]]),
    async () => {
      await venueRead(ctx())
    }
  )
  assert.equal(
    await bindingOf("4004"),
    ALICE_LOWER,
    "hygiene removes the hidden one before the address is read"
  )
  const [stored] = await db!.select().from(hmItems).where(eq(hmItems.coin, COIN))
  assert.ok(!stored!.content!.includes(THIEF_LOWER), "and it is not stored either")

  /* ── most pull requests mention nothing, and cost nothing ───────────────── */

  await reset()
  await withFetch(serve([[pull("Just a normal fix, no address.", 5005, "quiet")]]), async () => {
    await venueRead(ctx())
  })
  assert.equal(await bindingOf("5005"), null)
  assert.equal(
    (await claims()).length,
    0,
    "no row for the ordinary case, or the claims that matter would be buried"
  )

  /* ── the real journey: add your address to work already read ───────────── */

  await reset()
  // First read: the contributor did not know to include an address.
  await withFetch(serve([[pull("Fixes a real bug. No address yet.", 6006, "latecomer", "PR_LATE")]]),
    async () => {
      await venueRead(ctx())
    }
  )
  assert.equal(await bindingOf("6006"), null, "nothing to bind on the first pass")
  const itemsBefore = await db!.select().from(hmItems).where(eq(hmItems.coin, COIN))
  assert.equal(itemsBefore.length, 1)

  // They read the record, see themselves unpaid, and edit the description.
  await withFetch(
    serve([[pull(`Fixes a real bug. Payout: ${ALICE}`, 6006, "latecomer", "PR_LATE")]]),
    async () => {
      await venueRead(ctx())
    }
  )
  assert.equal(
    await bindingOf("6006"),
    ALICE_LOWER,
    "an address added AFTER the first read still binds, which is the whole journey"
  )
  const itemsAfter = await db!.select().from(hmItems).where(eq(hmItems.coin, COIN))
  assert.equal(itemsAfter.length, 1, "and it is the same contribution, not a second one")

  console.log("binding check passed")
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
