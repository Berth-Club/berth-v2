import { JOURNAL_PATH, makeDb } from "@workspace/db"

import { assertClockSafe, currentEpoch, epochBounds } from "./clock.js"
import { capabilities, env } from "./env.js"
import { ensureEpochTimer } from "./jobs/epochStart.js"
import { runLoop } from "./jobs/loop.js"
import { handlers, leaseSeconds } from "./jobs/registry.js"
import { waitForMigrations } from "./migrations.js"
import { redact } from "./redact.js"

/**
 * The worker: boot checks, then poll forever.
 *
 * The order matters. The clock is checked before anything touches the database,
 * because a compressed epoch would write rows for weeks the vault does not
 * recognise. Migrations are waited on before the first job is claimed, because
 * a handler running against a half-migrated schema is worse than one that has
 * not started.
 */

const log = (level: "info" | "error", msg: string, meta?: Record<string, unknown>) => {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta })
  if (level === "error") console.error(line)
  else console.log(line)
}

async function main() {
  assertClockSafe({ chainId: env.chainId, nodeEnv: env.nodeEnv })

  const db = makeDb(env.databaseUrl)
  if (!db) {
    log("error", "DATABASE_URL is not set, the worker has nothing to poll")
    process.exit(1)
  }

  const caps = capabilities()
  const epoch = currentEpoch()
  const { start, end } = epochBounds(epoch)
  log("info", "worker starting", {
    workerId: env.workerId,
    chainId: env.chainId,
    epoch,
    epochStart: start.toISOString(),
    epochEnd: end.toISOString(),
    ...caps,
  })

  for (const [name, ready] of Object.entries(caps)) {
    if (!ready) log("info", `${name} is not configured, its jobs will report it`, {})
  }

  const controller = new AbortController()
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      log("info", "shutting down", { signal })
      controller.abort()
    })
  }

  await waitForMigrations({ db, journalPath: JOURNAL_PATH, signal: controller.signal, log })
  if (controller.signal.aborted) return

  // The weekly clock. Nothing else creates it, so without this no week opens.
  await ensureEpochTimer(db)

  await runLoop({
    db,
    handlers,
    leaseSeconds,
    workerId: env.workerId,
    pollSeconds: env.pollSeconds,
    signal: controller.signal,
    log,
  })
}

main().catch((error) => {
  log("error", "worker crashed", { error: redact(error) })
  process.exit(1)
})
