import { makeDriver, pickDriverName, type Driver } from "./driver.js"
import { pageUrl, parseItems } from "./parse.js"
import { fetchTokens, openStore, saveTheses } from "./store.js"
import { sweepAll } from "./sweep.js"
import { noteSubjects, resolveWallets } from "./wallets.js"

/**
 * The FOMO reader.
 *
 * Watches the tokens berth.club says to watch, archives every thesis about
 * them, and writes into the Harbormaster's own database. The FOMO venue reads
 * that archive when a week closes.
 *
 * Deliberately does one thing. No alerts, no follow list, no Telegram: this
 * exists so a payout week cannot fail because some other service recycled its
 * browser.
 *
 *   pnpm --filter fomo-reader probe    show what one sweep would find
 *   pnpm --filter fomo-reader start     the loop
 *
 * On a laptop it attaches to the Chrome you already have signed in. On a server
 * it launches its own headless Chromium against a profile on a volume. See
 * `driver.ts`; nothing above that file knows which one it got.
 */

const TOKENS_URL =
  process.env.FOMO_TOKENS_URL ?? "http://localhost:3000/api/harbormaster/fomo-tokens"
const POLL_MS = Number(process.env.FOMO_POLL_SECONDS ?? 300) * 1000
/**
 * How far back each sweep reaches.
 *
 * Far longer than the interval on purpose. Overlapping windows cost nothing
 * because the unique id dedupes them, while a gap after a restart loses a
 * thesis permanently: the feed will not return it again.
 */
const LOOKBACK_S = Number(process.env.FOMO_LOOKBACK_SECONDS ?? 86_400)

const log = (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta })
  if (level === "info") console.log(line)
  else console.error(line)
}

async function probe() {
  const tokens = await fetchTokens(TOKENS_URL)
  if (!tokens || tokens.length === 0) {
    console.log(`no tokens from ${TOKENS_URL}`)
    return
  }
  console.log(`${tokens.length} token(s) to watch`)
  const driver = await makeDriver()
  console.log(`driver: ${driver.name}`)
  if (!(await driver.ensureSession())) {
    console.log("no FOMO session. Sign in at fomo.family, then retry.")
    await driver.close?.()
    return
  }
  for (const t of tokens) {
    const res = await driver.apiGet(pageUrl(t, Date.now() - LOOKBACK_S * 1000, Date.now(), 3))
    console.log(`\n=== ${t.networkId}:${t.tokenAddress} ===`)
    if (!res.ok) {
      console.log(`  error ${res.status}`)
      continue
    }
    const items = parseItems(res.body)
    console.log(`  parsed ${items === null ? "UNRECOGNISED SHAPE" : items.length + " item(s)"}`)
    if (items?.[0]) console.log("  sample:", JSON.stringify(items[0]).slice(0, 400))
  }
  await driver.close?.()
}

/** Reachable from the signal handler, which is installed before the driver exists. */
let driverRef: Driver | null = null

async function main() {
  if (process.argv.includes("--probe")) {
    await probe()
    return
  }

  const db = openStore(process.env.DATABASE_URL)
  if (!db) {
    log("error", "DATABASE_URL is not set, there is nowhere to archive")
    process.exit(1)
  }

  // Not an empty list: an unreachable endpoint must leave the last known
  // tokens alone rather than being read as "watch nothing".
  let tokens = (await fetchTokens(TOKENS_URL)) ?? []

  let stopping = false
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      stopping = true
      log("info", "shutting down", { sig })
      // Close the browser before exiting. Chromium writes localStorage to disk
      // lazily, and FOMO rotates its refresh token on use: exiting without a
      // flush leaves the OLD token in the profile, and the next deploy boots
      // signed out with nothing to say why.
      void Promise.resolve(driverRef?.close?.())
        .catch(() => {})
        .finally(() => process.exit(0))
    })
  }

  const driver: Driver = await makeDriver()
  driverRef = driver
  if (!(await driver.ensureSession())) {
    log("warn", "no FOMO session yet; sign in at fomo.family")
  }
  // Chromium only grows, so a driver that owns one recycles on a timer. The
  // attach-to-your-browser driver has nothing to recycle and says so by not
  // implementing it.
  const RECYCLE_MS = Number(process.env.FOMO_RECYCLE_HOURS ?? 6) * 3600 * 1000
  let nextRecycle = Date.now() + RECYCLE_MS
  log("info", "reader started", {
    driver: driver.name,
    tokens: tokens.length,
    pollSeconds: POLL_MS / 1000,
  })

  while (!stopping) {
    try {
      if (driver.restart && Date.now() > nextRecycle) {
        log("info", "recycling the browser")
        await driver.restart()
        await driver.ensureSession()
        nextRecycle = Date.now() + RECYCLE_MS
      }

      const fresh = await fetchTokens(TOKENS_URL)
      if (fresh) tokens = fresh

      if (tokens.length === 0) {
        log("info", "no tokens configured yet")
      } else {
        const since = Date.now() - LOOKBACK_S * 1000
        const { theses, notes } = await sweepAll(driver, tokens, since)
        const stored = await saveTheses(db, theses)
        // Callouts first, then authors. A callout stored without its author's
        // wallet is a payment pending; an author noted whose callout was lost is
        // nothing at all, and the feed will not hand that callout back.
        await noteSubjects(db, theses)
        for (const n of notes) log("warn", "sweep", { note: n })
        if (stored > 0 || notes.length > 0) {
          log("info", "swept", { tokens: tokens.length, seen: theses.length, stored })
        }

        // Drains a batch per sweep rather than all of it. A token that suddenly
        // attracts three hundred new authors must not stall the next read of
        // every other token behind three hundred lookups.
        const w = await resolveWallets(db, driver)
        for (const n of w.notes) log("warn", "wallet", { note: n })
        if (w.resolved > 0) {
          log("info", "wallets resolved", { asked: w.resolved, withWallet: w.withWallet })
        }
        // A 429 is not an error to swallow. It is the one signal that the
        // backlog is draining slower than authors are arriving, and the fix is
        // a config change rather than a retry.
        if (w.rateLimited) log("warn", "wallet lookups rate limited by FOMO")
        // An empty sweep across every token is what a dead session looks like,
        // and it looks identical to a quiet market. Say so rather than idling.
        if (theses.length === 0 && notes.length === 0) {
          log("warn", "nothing returned for any token; session may be stale")
        }
      }
    } catch (e) {
      log("error", "sweep failed", { error: (e as Error).message })
      // The session is the usual cause. Re-open the tab and re-hook rather
      // than spinning on a browser that has navigated away.
      await driver.ensureSession().catch(() => false)
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

main().catch((e) => {
  log("error", "reader crashed", { error: (e as Error).message })
  process.exit(1)
})
