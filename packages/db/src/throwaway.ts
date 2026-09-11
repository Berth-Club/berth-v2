/**
 * Refuse to let a destructive script run against a database that matters.
 *
 * Every check in this repo truncates the Harbormaster tables before it starts,
 * which was safe while `DATABASE_URL` had to be typed on the command line. Once
 * the worker reads a `.env` file, the variable is ambient: `pnpm --filter agent
 * check:lane` in a shell where someone pasted the production URL would wipe
 * real payout history without asking anything.
 *
 * So the rule is whitelist, not blacklist. A URL has to look local before it is
 * allowed, because guessing which remote hosts are dangerous is a game you only
 * have to lose once. Set `HM_ALLOW_DESTRUCTIVE=i-know` to override it for a
 * remote throwaway, which is deliberately awkward to type by accident.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"])

/** The override, spelled out so it cannot be set by reflex. */
const OVERRIDE = "i-know"

export interface ThrowawayVerdict {
  ok: boolean
  reason: string
}

export function checkThrowaway(url: string | undefined): ThrowawayVerdict {
  if (!url) return { ok: false, reason: "DATABASE_URL is not set" }

  if (process.env.HM_ALLOW_DESTRUCTIVE === OVERRIDE) {
    return { ok: true, reason: `HM_ALLOW_DESTRUCTIVE=${OVERRIDE} is set` }
  }

  let host: string
  let database: string
  try {
    const parsed = new URL(url)
    host = parsed.hostname
    database = parsed.pathname.replace(/^\//, "")
  } catch {
    return { ok: false, reason: "DATABASE_URL could not be parsed" }
  }

  if (!LOCAL_HOSTS.has(host)) {
    return {
      ok: false,
      reason:
        `refusing to truncate tables on "${host}": this script is destructive and ` +
        `only runs against a local database. Set HM_ALLOW_DESTRUCTIVE=${OVERRIDE} ` +
        `if that host really is a throwaway.`,
    }
  }

  // Local but still worth a second look: a developer's own long-lived database
  // is local too, and losing a week of hand-made fixtures is a real annoyance.
  if (!/(test|dev|throwaway|scratch|tmp)/i.test(database)) {
    return {
      ok: false,
      reason:
        `refusing to truncate tables in "${database}": the name does not look ` +
        `disposable. Rename it, or set HM_ALLOW_DESTRUCTIVE=${OVERRIDE}.`,
    }
  }

  return { ok: true, reason: `${database} on ${host}` }
}

/** Exit rather than truncate, printing why. Called before the first write. */
export function assertThrowaway(url: string | undefined): void {
  const verdict = checkThrowaway(url)
  if (!verdict.ok) {
    console.error(`\n  ${verdict.reason}\n`)
    process.exit(1)
  }
}
