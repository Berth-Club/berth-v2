import { chromium, type BrowserContext, type Page } from "playwright"

import {
  fetchManyScript,
  fetchScript,
  HOOK_SOURCE,
  type Driver,
  type FetchResult,
} from "./driver.js"

/**
 * A headless Chromium this process owns.
 *
 * The driver for a server. Nothing to attach to there, so the reader brings its
 * own browser and keeps a profile on a volume.
 *
 * There is still no credential in this code. The profile holds the session, the
 * app refreshes its own token, and what we take is the Authorization header it
 * already sends. A profile expiring is a person signing in again, not a secret
 * to rotate.
 *
 * One account per reader. Privy rotates the refresh token on use, so two
 * processes sharing a profile lock each other out, and the symptom is an empty
 * feed rather than an error.
 */

const PROFILE = process.env.FOMO_PROFILE_DIR ?? "./.fomo-profile"

/**
 * Where a session is opened. A token page, not the home page.
 *
 * A token page is verified to make authenticated API calls as soon as it loads,
 * which is what the auth hook copies. Whether the logged-in home page does is
 * not verified, and a page that makes no call leaves the reader "signed in" with
 * nothing to borrow.
 */
const WARMUP =
  process.env.FOMO_WARMUP_URL ??
  "https://fomo.family/tokens/robinhood/0x10b409f69989bc34e36a5105874f6d64e3eb0bff"

/**
 * The first two flags are required in a container: it runs as root on a small
 * /dev/shm. The rest trim resident memory, because this browser exists only to
 * satisfy Cloudflare and hold a session, so anything rendering-related is pure
 * overhead. `--single-process` is deliberately absent: it saves memory and
 * makes crashes far likelier, and this runs unattended for weeks.
 */
const ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-sync",
  "--mute-audio",
  "--js-flags=--max-old-space-size=192",
]

/**
 * The `privy:*` localStorage entries to start from, or null.
 *
 * Base64 of a JSON object, so a multi-line token survives being a Railway
 * variable. Anything that is not a `privy:` key is dropped: this is a login
 * handover, not a way to write arbitrary state into someone else's app.
 */
function sessionSeed(): Record<string, string> | null {
  const raw = process.env.FOMO_SESSION_B64
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (k.startsWith("privy:") && typeof v === "string") out[k] = v
    }
    return out["privy:refresh_token"] ? out : null
  } catch {
    console.warn("[warn] FOMO_SESSION_B64 is set but unreadable")
    return null
  }
}

/**
 * The browser's own user agent with "HeadlessChrome" replaced by "Chrome".
 *
 * FOMO serves a headless browser its logged-out marketing page and never boots
 * the app. Verified on Railway on 2026-09-13: with the default agent the page
 * made zero requests to Privy and zero API calls, with a valid session in
 * localStorage. With only this one word changed the app booted and Privy
 * started. Read from a real launch rather than hard-coded, so the version in
 * the string always matches the Chromium actually running.
 */
async function plainUserAgent(): Promise<string | undefined> {
  if (process.env.FOMO_USER_AGENT) return process.env.FOMO_USER_AGENT
  const b = await chromium.launch({ headless: true, args: ARGS })
  try {
    const page = await b.newPage()
    return (await page.evaluate(() => navigator.userAgent)).replace("HeadlessChrome", "Chrome")
  } finally {
    await b.close()
  }
}

export function makePlaywrightDriver(): Driver {
  let ctx: BrowserContext | null = null

  const open = async (): Promise<BrowserContext> => {
    if (ctx) return ctx
    const headless = process.env.FOMO_HEADFUL !== "1"
    ctx = await chromium.launchPersistentContext(PROFILE, {
      headless,
      args: ARGS,
      viewport: { width: 1280, height: 900 },
      userAgent: headless ? await plainUserAgent() : undefined,
    })
    // Before any app code runs. Hooking afterwards catches nothing, because
    // the app already captured its own fetch reference.
    await ctx.addInitScript(HOOK_SOURCE)
    // Privy refreshes the login every time the app boots. Its status is the one
    // thing that separates "the session is dead" from "the app never made a
    // call we could copy", and those two need opposite fixes. Status only.
    ctx.on("response", (r) => {
      if (r.url().includes("auth.privy.io/api/v1/sessions")) {
        console.log(`[info] privy session refresh: HTTP ${r.status()}`)
      }
    })
    return ctx
  }

  /**
   * Any page still alive.
   *
   * Sign-in navigates away and can open a second window, so the page a session
   * started on is often not the one holding the token. Holding a single page
   * object and waiting on it throws "target closed" the moment that happens.
   */
  const live = (c: BrowserContext): Page | null => {
    const pages = c.pages()
    return pages.length > 0 ? pages[pages.length - 1]! : null
  }

  const hasAuth = async (c: BrowserContext): Promise<boolean> => {
    for (const page of c.pages()) {
      try {
        const ok = await page.evaluate(() =>
          Boolean((window as never as { __hmHeaders: unknown }).__hmHeaders)
        )
        if (ok) return true
      } catch {
        // A page closed or navigated mid-check. Normal during sign-in.
      }
    }
    return false
  }

  return {
    name: "playwright",

    async ensureSession(timeoutSeconds = 40) {
      const c = await open()
      if (c.pages().length === 0) await c.newPage()
      const page = live(c)!
      await page.goto(WARMUP, { timeout: 60_000, waitUntil: "domcontentloaded" }).catch(() => {})

      // A server has no one to sign in, so the first login is handed over.
      // FOMO keeps its whole session in localStorage (`privy:token`,
      // `privy:refresh_token`, ...); cookies are only Cloudflare's. Seeding
      // those keys is the same as having signed in here.
      //
      // Only into a profile that has no session of its own. Privy rotates the
      // refresh token on every use, so the copy in the env goes stale the first
      // time this browser refreshes; writing it over a live profile after a
      // restart would replace a working session with a dead one.
      const seed = sessionSeed()
      if (seed) {
        const seeded = await page
          .evaluate((entries) => {
            if (localStorage.getItem("privy:refresh_token")) return false
            for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v)
            return true
          }, seed)
          .catch(() => false)
        if (seeded) {
          console.log("[info] seeded the FOMO session from FOMO_SESSION_B64")
          await page.reload({ timeout: 60_000, waitUntil: "domcontentloaded" }).catch(() => {})
        }
      }

      const deadline = Date.now() + timeoutSeconds * 1000
      while (Date.now() < deadline) {
        if (await hasAuth(c)) return true
        // A plain timer, not `page.waitForTimeout`: the page may not survive.
        await new Promise((r) => setTimeout(r, 1500))
      }
      return false
    },

    async apiGet(url): Promise<FetchResult> {
      const c = await open()
      const page = live(c)
      if (!page) return { ok: false, status: "no-page" }
      try {
        const raw = await page.evaluate(fetchScript(url))
        return JSON.parse(String(raw)) as FetchResult
      } catch (e) {
        return { ok: false, status: (e as Error).message }
      }
    },

    async apiGetMany(urls, spacingMs = 1000): Promise<FetchResult[]> {
      if (urls.length === 0) return []
      const c = await open()
      const page = live(c)
      if (!page) return [{ ok: false, status: "no-page" }]
      try {
        // The default evaluate timeout is thirty seconds and the page sleeps
        // between calls, so the budget has to cover the whole paced batch.
        page.setDefaultTimeout(60_000 + urls.length * (spacingMs + 5_000))
        const raw = await page.evaluate(fetchManyScript(urls, spacingMs))
        return JSON.parse(String(raw)) as FetchResult[]
      } catch (e) {
        return [{ ok: false, status: (e as Error).message }]
      }
    },

    async restart() {
      await ctx?.close().catch(() => {})
      ctx = null
    },

    async close() {
      await ctx?.close().catch(() => {})
      ctx = null
    },
  }
}
