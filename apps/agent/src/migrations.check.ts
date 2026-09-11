import assert from "node:assert/strict"

import { JOURNAL_PATH, makeDb } from "@workspace/db"
import { sql } from "drizzle-orm"

import { readState, waitForMigrations } from "./migrations.js"

/**
 * The migration gate, against a real Postgres.
 *
 *   DATABASE_URL=postgres://…/throwaway pnpm --filter agent check:migrations
 */

const db = makeDb(process.env.DATABASE_URL)
if (!db) {
  console.error("DATABASE_URL is not set. Point it at a throwaway database.")
  process.exit(1)
}

const journalPath = JOURNAL_PATH

async function main() {
  const state = await readState(db!, journalPath)
  assert.equal(state.status, "ready", "a migrated database matches this build")
  assert.equal(state.actual, state.expected)

  // Behind: the web app has not applied this build's migration yet.
  const [saved] = await db!.execute<{ id: number; created_at: string }>(
    sql`select id, created_at::text from drizzle.__drizzle_migrations order by created_at desc limit 1`
  )
  await db!.execute(sql`update drizzle.__drizzle_migrations set created_at = 1 where id = ${saved!.id}`)
  const behind = await readState(db!, journalPath)
  assert.equal(behind.status, "behind", "an older database is behind")

  // And the gate does not return while it is.
  const controller = new AbortController()
  let returned = false
  const waiting = waitForMigrations({
    db: db!,
    journalPath,
    pollSeconds: 0.05,
    signal: controller.signal,
    log: () => {},
  }).then(() => {
    returned = true
  })
  await new Promise((r) => setTimeout(r, 250))
  assert.equal(returned, false, "it keeps waiting while the schema is behind")

  // Restore, and it proceeds.
  await db!.execute(
    sql`update drizzle.__drizzle_migrations set created_at = ${Number(saved!.created_at)} where id = ${saved!.id}`
  )
  await waiting
  assert.equal(returned, true, "once the web app catches up, the worker starts")

  // Ahead: this build is the old one and the web app has moved on.
  await db!.execute(sql`update drizzle.__drizzle_migrations set created_at = 99999999999999 where id = ${saved!.id}`)
  assert.equal((await readState(db!, journalPath)).status, "ahead", "a newer database is ahead")
  await db!.execute(
    sql`update drizzle.__drizzle_migrations set created_at = ${Number(saved!.created_at)} where id = ${saved!.id}`
  )
  assert.equal((await readState(db!, journalPath)).status, "ready", "restored")

  console.log("migrations check passed")
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
