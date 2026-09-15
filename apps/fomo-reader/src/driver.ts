/**
 * How this process gets inside a signed-in browser.
 *
 * FOMO has no public API. Its backend sits behind Cloudflare, which rejects a
 * plain HTTP client whatever headers it sends, and behind a short-lived Privy
 * bearer token held in localStorage rather than a cookie. So every call has to
 * originate from a real, signed-in browser, and the only question is whose.
 *
 * Two answers, because the two environments genuinely differ:
 *
 * `browser-use` attaches to the Chrome already open on this machine. Nothing to
 * install, nothing to sign into twice, and no second browser appearing on
 * someone's desktop. It cannot run unattended, because there is no open browser
 * on a server.
 *
 * `playwright` owns a headless Chromium of its own, with a profile on a volume.
 * That is what Railway needs, and it is the only option there.
 *
 * Both satisfy the same contract, and the contract is small on purpose: open a
 * session, and GET a URL with the app's own Authorization header. Everything
 * above this file, the paging, the window arithmetic, the archive, is identical
 * either way and is tested without a browser at all.
 */

export type FetchResult =
  | { ok: true; body: unknown }
  | {
      ok: false
      status: number | string
      body?: string
      /** From `retry-after` on a 429. Cloudflare sends it and it is worth obeying. */
      retryAfterSeconds?: number
    }

export interface Driver {
  readonly name: string
  /**
   * Open FOMO, install the auth hook, and wait for the app to authenticate
   * itself. False means there is no usable session, which is a thing to report
   * rather than throw: a stale session and a quiet market look identical, and
   * only this can tell them apart.
   */
  ensureSession(timeoutSeconds?: number): Promise<boolean>
  /** GET one FOMO API URL from inside the page. */
  apiGet(url: string): Promise<FetchResult>
  /**
   * GET several URLs in ONE trip into the page, paced.
   *
   * Both halves matter. The pacing is because FOMO does rate limit after all,
   * whatever was said about there being no limit. Measured on 2026-09-12: the
   * seventh request in a row returns 429 with `retry-after: 60`, and it does so
   * whether they are fired back to back or spaced 1.5s apart. So the limit is a
   * COUNT, not a rate, and slowing down within a window buys nothing. Six is
   * the budget; the sweep interval is what refills it.
   *
   * The single trip is because the attach-to-your-browser driver spawns a CLI
   * process per call, so two hundred authors meant two hundred processes and
   * two hundred chances for the tab underneath to move.
   *
   * Stops at the first 429 and returns what it has. Burning the rest of the
   * batch against a closed door only pushes the limit further out.
   */
  apiGetMany(urls: readonly string[], spacingMs?: number): Promise<FetchResult[]>
  /** Drop and reopen the browser. Chromium only grows; a long run must recycle. */
  restart?(): Promise<void>
  close?(): Promise<void>
}

/**
 * The script injected before any app code runs.
 *
 * That timing is the whole trick and the only part that is fragile: the app
 * captures its own `fetch` reference at boot, so hooking afterwards catches
 * nothing at all. Shared by both drivers so they cannot drift.
 */
export const HOOK_SOURCE = `
  window.__hmHeaders = null;
  window.__hmFetch = window.fetch.bind(window);
  const original = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (url.includes("prod-api.fomo.family")) {
        const h = (init && init.headers) || (input && input.headers);
        if (h) {
          var out = {};
          if (typeof h.forEach === "function" && !Array.isArray(h)) {
            h.forEach(function (v, k) { out[k] = v; });
          } else if (Array.isArray(h)) {
            for (var i = 0; i < h.length; i++) out[h[i][0]] = h[i][1];
          } else {
            Object.assign(out, h);
          }
          if (out.authorization || out.Authorization) window.__hmHeaders = out;
        }
      }
    } catch (e) { /* never break the app we are borrowing from */ }
    return original.apply(this, arguments);
  };
`

/** Any in-app page will do; it exists to boot the session and the hook. */
export const APP = "https://fomo.family"

/**
 * The call made from inside the page, as a string both drivers evaluate.
 *
 * Returns a JSON string rather than an object, because what survives the trip
 * out of a page differs between the two drivers and a string does not.
 */
export function fetchScript(url: string): string {
  return `
(async () => {
  if (!window.__hmHeaders) return JSON.stringify({ok:false, status:'no-auth'});
  try {
    const r = await window.__hmFetch(${JSON.stringify(url)}, {headers: window.__hmHeaders});
    if (!r.ok) {
      const ra = Number(r.headers.get('retry-after'));
      return JSON.stringify({ok:false, status:r.status,
        retryAfterSeconds: Number.isFinite(ra) ? ra : undefined,
        body:(await r.text()).slice(0,200)});
    }
    return JSON.stringify({ok:true, body: await r.json()});
  } catch (e) { return JSON.stringify({ok:false, status:String(e)}); }
})()
`
}

/**
 * Several calls in one evaluation, spaced, as a string both drivers evaluate.
 *
 * The waiting happens INSIDE the page. Doing it outside would mean one trip per
 * URL, which is the cost this exists to avoid.
 */
export function fetchManyScript(urls: readonly string[], spacingMs: number): string {
  return `
(async () => {
  if (!window.__hmHeaders) return JSON.stringify([{ok:false, status:'no-auth'}]);
  const urls = ${JSON.stringify(urls)};
  const out = [];
  for (let i = 0; i < urls.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, ${Math.max(0, Math.floor(spacingMs))}));
    try {
      const r = await window.__hmFetch(urls[i], {headers: window.__hmHeaders});
      if (r.status === 429) {
        // Stop the batch. The rest would be 429 too, and each attempt is
        // another request counted against whatever window is being enforced.
        const ra = Number(r.headers.get('retry-after'));
        out.push({ok:false, status:429, retryAfterSeconds: Number.isFinite(ra) ? ra : undefined});
        break;
      }
      if (!r.ok) { out.push({ok:false, status:r.status, body:(await r.text()).slice(0,200)}); continue; }
      out.push({ok:true, body: await r.json()});
    } catch (e) { out.push({ok:false, status:String(e)}); }
  }
  return JSON.stringify(out);
})()
`
}

/**
 * Which driver to use.
 *
 * Explicit `FOMO_DRIVER` wins. Otherwise: a server has no open browser to
 * attach to, so anything that looks like one gets its own. Guessing wrong in
 * that direction fails loudly at startup; guessing wrong the other way would
 * open a browser window on someone's desktop.
 */
export function pickDriverName(): "browser-use" | "playwright" {
  const explicit = process.env.FOMO_DRIVER?.toLowerCase()
  if (explicit === "playwright" || explicit === "browser-use") return explicit
  const onServer = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.CI)
  return onServer ? "playwright" : "browser-use"
}

export async function makeDriver(): Promise<Driver> {
  const name = pickDriverName()
  if (name === "playwright") {
    const { makePlaywrightDriver } = await import("./driver-playwright.js")
    return makePlaywrightDriver()
  }
  const { makeBrowserUseDriver } = await import("./driver-browser-use.js")
  return makeBrowserUseDriver()
}
