import { spawn } from "node:child_process"

import {
  APP,
  fetchManyScript,
  fetchScript,
  HOOK_SOURCE,
  type Driver,
  type FetchResult,
} from "./driver.js"

/**
 * The Chrome already open on this machine, through the `browser-use` CLI.
 *
 * The driver for a laptop. Nothing to install, nothing to sign into twice, and
 * no second browser window appearing while someone is working.
 *
 * It cannot run unattended: there is no open browser on a server to attach to.
 * That is what the Playwright driver is for, and picking between them is the
 * only thing that differs between the two environments.
 */

/**
 * Run a script through the `browser-use` CLI, which reads it on stdin.
 *
 * Written with `spawn` and an explicit write, NOT `execFile({ input })`.
 * `input` is a `spawnSync` option and `execFile` ignores it silently, so the
 * CLI sat waiting on a stdin that never closed until the timeout killed it: no
 * output, no error, just SIGTERM after two minutes. A cast to `never` had hidden
 * the wrong option from the compiler.
 */
function browserUse(script: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("browser-use", [], { stdio: ["pipe", "pipe", "pipe"] })
    let out = ""
    let err = ""
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, timeoutMs)

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (d: string) => {
      out += d
    })
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (d: string) => {
      err += d
    })

    child.on("error", (e) => {
      clearTimeout(timer)
      reject(new Error(`browser-use could not be started: ${e.message}`))
    })

    child.on("close", (code) => {
      clearTimeout(timer)
      if (timedOut) return reject(new Error(`browser-use timed out after ${timeoutMs}ms`))
      // A non-zero exit with usable output still counts: the payload is printed
      // before whatever the CLI complains about on the way out.
      if (code !== 0 && out.trim().length === 0) {
        return reject(new Error(`browser-use exited ${code}: ${err.trim().slice(0, 300)}`))
      }
      resolve(out)
    })

    // Closing stdin is the part that matters. The CLI reads until EOF.
    child.stdin.end(script, "utf8")
  })
}

/**
 * The last JSON object a script printed.
 *
 * browser-use prefixes its own chatter, so the payload is found by scanning
 * from the end rather than by parsing the whole output.
 */
function lastJson<T>(out: string): T | null {
  for (const line of out.trim().split("\n").reverse()) {
    const t = line.trim()
    if (!t.startsWith("{")) continue
    try {
      return JSON.parse(t) as T
    } catch {
      // Not the payload. Keep looking.
    }
  }
  return null
}

/** The last JSON array a script printed. Same scan, different opening brace. */
function lastJsonArray<T>(out: string): T[] | null {
  for (const line of out.trim().split("\n").reverse()) {
    const t = line.trim()
    if (!t.startsWith("[")) continue
    try {
      return JSON.parse(t) as T[]
    } catch {
      // Not the payload. Keep looking.
    }
  }
  return null
}

export function makeBrowserUseDriver(): Driver {
  return {
    name: "browser-use",

    async ensureSession(timeoutSeconds = 40) {
      const out = await browserUse(
        `
import time, json
# Open the tab FIRST. A cdp() call before this lands on whatever session the
# daemon is holding, which is not the new tab's, so the hook registers against
# nothing and never runs. Verified on 2026-09-12: window.__hmFetch was
# undefined on the loaded page. Register on the tab we have, then reload, so
# the hook is in place before the app captures its own fetch reference.
new_tab("${APP}")
wait_for_load()
cdp("Page.enable")
cdp("Page.addScriptToEvaluateOnNewDocument", source="""${HOOK_SOURCE}""")
cdp("Page.reload")
time.sleep(4)
wait_for_load()
if js("typeof window.__hmFetch") != "function":
    print(json.dumps({"auth": False, "why": "hook-not-installed"}))
else:
    deadline = time.time() + ${timeoutSeconds}
    ok = False
    while time.time() < deadline:
        time.sleep(2)
        try:
            if js("Boolean(window.__hmHeaders)"):
                ok = True
                break
        except Exception:
            pass
    print(json.dumps({"auth": bool(ok)}))
`,
        (timeoutSeconds + 90) * 1000
      )
      return lastJson<{ auth?: boolean }>(out)?.auth === true
    },

    async apiGet(url): Promise<FetchResult> {
      try {
        const out = await browserUse(`
res = js("""${fetchScript(url)}""")
print(res)
`)
        return lastJson<FetchResult>(out) ?? { ok: false, status: "unreadable-response" }
      } catch (e) {
        return { ok: false, status: (e as Error).message }
      }
    },

    async apiGetMany(urls, spacingMs = 1500): Promise<FetchResult[]> {
      if (urls.length === 0) return []

      // Pacing on the PYTHON side, one short evaluation per URL, not one long
      // evaluation that sleeps. `js()` has its own Runtime.evaluate timeout and
      // a batch that waits inside the page blows straight through it: fifteen
      // lookups at 1.5s each is twenty-two seconds of sleeping in one call, and
      // it failed with a CDP traceback rather than a result.
      //
      // Still one process for the whole batch, which was the other half of the
      // point: the alternative spawned a CLI per lookup.
      const calls = urls
        .map(
          (u, i) => `
${i > 0 ? `time.sleep(${spacingMs / 1000})` : ""}
res = js("""${fetchScript(u)}""")
out.append(json.loads(res))
if out[-1].get("status") == 429:
    # Stop the batch. The rest would be 429 too, and each attempt is another
    # request counted against whatever window is being enforced.
    raise SystemExit(_done())
`
        )
        .join("")

      const script = `
import time, json
out = []
def _done():
    print(json.dumps(out))
    return 0
${calls}
_done()
`
      const budget = 60_000 + urls.length * (spacingMs + 5_000)
      try {
        const out = await browserUse(script, budget)
        return lastJsonArray<FetchResult>(out) ?? [{ ok: false, status: "unreadable-response" }]
      } catch (e) {
        return [{ ok: false, status: (e as Error).message }]
      }
    },
  }
}

/** Is browser-use installed and able to reach a browser? */
export async function browserUseAvailable(): Promise<boolean> {
  try {
    await browserUse("print(1)", 30_000)
    return true
  } catch {
    return false
  }
}
