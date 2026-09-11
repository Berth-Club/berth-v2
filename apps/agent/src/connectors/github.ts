import type { LaneItem, LaneResult, ReaderContext } from "./types.js"

/**
 * Merged pull requests, per repository, for one week.
 *
 * Two choices worth the words.
 *
 * NOT the Search API. `is:pr is:merged merged:A..B` looks like exactly the right
 * query and is the wrong tool: it allows 30 requests a minute against 5,000 an
 * hour for the REST endpoints, caps at 1,000 results, and — the part that
 * actually disqualifies it — returns `incomplete_results: true` with a short
 * list when it times out. A reader that silently returns half a week's work
 * would pay half the people and nobody would know. Listing a repo's closed pull
 * requests newest-first and stopping at the window is deterministic and cheap.
 *
 * Repositories are addressed by numeric id, not `owner/name`. A repo that is
 * renamed or transferred keeps its id, so a coin's rules keep pointing at the
 * same project. GitHub redirects the id form, which is exactly the behaviour we
 * want and the reason the resolver stores ids at confirm time.
 */

const API = "https://api.github.com"
const PER_PAGE = 100
/** A page of 100 covers a busy week; more than this means the window is wrong. */
const MAX_PAGES_PER_REPO = 20

interface GithubPull {
  number: number
  node_id: string
  title: string
  body: string | null
  html_url: string
  merged_at: string | null
  updated_at: string
  user: { id: number; login: string } | null
  additions?: number
  deletions?: number
  changed_files?: number
}

export interface GithubReaderOptions {
  token?: string
  /** Injected in checks so the reader can be exercised without the network. */
  fetchImpl?: typeof fetch
}

class RateLimited extends Error {
  constructor(public resetAt: Date | null) {
    super("GitHub rate limit reached")
    this.name = "RateLimited"
  }
}

export function makeGithubReader(opts: GithubReaderOptions = {}) {
  const doFetch = opts.fetchImpl ?? fetch

  async function get(path: string, signal?: AbortSignal): Promise<GithubPull[]> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "berth-harbormaster",
    }
    if (opts.token) headers.authorization = `Bearer ${opts.token}`

    const res = await doFetch(`${API}${path}`, { headers, signal })

    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get("x-ratelimit-remaining")
      if (remaining === "0" || res.status === 429) {
        const reset = res.headers.get("x-ratelimit-reset")
        throw new RateLimited(reset ? new Date(Number(reset) * 1000) : null)
      }
    }
    if (!res.ok) {
      throw new Error(`GitHub returned ${res.status} for ${path}`)
    }
    return (await res.json()) as GithubPull[]
  }

  return async function readGithub(ctx: ReaderContext): Promise<LaneResult> {
    const repos = ctx.sources.github ?? []
    if (repos.length === 0) {
      return { status: "ok", items: [], reason: "no repositories in this coin's rules" }
    }
    if (!opts.token) {
      return { status: "failed", items: [], reason: "not configured: GITHUB_TOKEN is unset" }
    }

    const items: LaneItem[] = []
    const partials: string[] = []

    for (const repo of repos) {
      try {
        const found = await readRepo(repo.repoId, ctx, get, items.length)
        items.push(...found.items)
        if (found.reason) partials.push(found.reason)
      } catch (error) {
        if (error instanceof RateLimited) {
          // Keep what was read and say so. Discarding it would throw away a
          // whole week of other repositories over one slow one.
          partials.push(
            `rate limited on repo ${repo.name ?? repo.repoId}` +
              (error.resetAt ? `, resets ${error.resetAt.toISOString()}` : "")
          )
          break
        }
        // One unreadable repository fails the lane rather than quietly
        // shrinking the week: a coin whose main repo 404s must not publish a
        // list that looks complete.
        return {
          status: "failed",
          items,
          reason: `repo ${repo.name ?? repo.repoId}: ${(error as Error).message}`,
        }
      }
      if (items.length >= ctx.cap) {
        partials.push(`stopped at the ${ctx.cap} item cap`)
        break
      }
    }

    return partials.length > 0
      ? { status: "partial", items, reason: partials.join("; ") }
      : { status: "ok", items }
  }
}

/**
 * One repository's merged pull requests inside the window.
 *
 * Sorting by `updated` newest-first and stopping once updates predate the
 * window is what bounds the paging. A pull request merged in the window is
 * always updated at or after its merge, so it cannot be missed by stopping
 * there, and edits after the fact only ever pull a row earlier in the list.
 */
async function readRepo(
  repoId: number,
  ctx: ReaderContext,
  get: (path: string, signal?: AbortSignal) => Promise<GithubPull[]>,
  alreadyHeld: number
): Promise<{ items: LaneItem[]; reason?: string }> {
  const items: LaneItem[] = []
  const { start, end } = ctx.window

  for (let page = 1; page <= MAX_PAGES_PER_REPO; page++) {
    const pulls = await get(
      `/repositories/${repoId}/pulls?state=closed&sort=updated&direction=desc` +
        `&per_page=${PER_PAGE}&page=${page}`,
      ctx.signal
    )
    if (pulls.length === 0) break

    let sawOlder = false
    for (const pr of pulls) {
      if (new Date(pr.updated_at) < start) {
        sawOlder = true
        continue
      }
      if (!pr.merged_at) continue // closed without merging: not work

      const mergedAt = new Date(pr.merged_at)
      // Half-open, so a merge exactly at the boundary lands on one week only.
      if (mergedAt < start || mergedAt >= end) continue
      if (!pr.user) continue // ghosted author: nobody to pay

      items.push({
        platform: "github",
        platformUserId: String(pr.user.id),
        platformHandle: pr.user.login,
        externalId: pr.node_id,
        link: pr.html_url,
        // Raw on purpose. Hygiene runs once, in the lane job, so the rule
        // "nothing author-written is stored uncleaned" holds for every lane
        // without each reader having to remember it.
        content: `${pr.title}\n\n${pr.body ?? ""}`,
        createdAt: mergedAt,
        meta: {
          repoId,
          number: pr.number,
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changed_files,
        },
      })

      if (alreadyHeld + items.length >= ctx.cap) {
        return { items, reason: `stopped at the ${ctx.cap} item cap` }
      }
    }

    // Everything on this page predates the window, and pages only get older.
    if (sawOlder && items.length === 0 && page > 1) break
    if (pulls.length < PER_PAGE) break
    if (page === MAX_PAGES_PER_REPO) {
      return { items, reason: `repo ${repoId} has more than ${MAX_PAGES_PER_REPO} pages of updates` }
    }
  }

  return { items }
}
