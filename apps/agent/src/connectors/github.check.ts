import assert from "node:assert/strict"

import { makeGithubReader } from "./github.js"
import type { ReaderContext } from "./types.js"

/**
 * The GitHub reader, against fixtures rather than the network.
 *
 * The cases that matter are the boundaries and the failures: a merge one second
 * either side of the window, a rate limit halfway through, a repository that
 * 404s. Each one is a way a week could quietly pay the wrong people, and none
 * of them is reachable by pointing the reader at a live repository.
 *
 *   pnpm --filter agent check:github
 */

const WINDOW = {
  start: new Date("2026-09-07T00:00:00Z"), // a Monday
  end: new Date("2026-09-14T00:00:00Z"),
}

let nextId = 1
function pull(over: Partial<Record<string, unknown>> = {}) {
  const id = nextId++
  return {
    number: id,
    node_id: `PR_node_${id}`,
    title: `Change ${id}`,
    body: "does a thing",
    html_url: `https://github.com/acme/app/pull/${id}`,
    merged_at: "2026-09-09T12:00:00Z",
    updated_at: "2026-09-09T12:00:00Z",
    user: { id: 1000 + id, login: `dev${id}` },
    ...over,
  }
}

/** A fetch that serves pages from a map of path prefix to pages of pulls. */
function fakeFetch(
  pagesByRepo: Record<number, unknown[][]>,
  opts: { failRepo?: number; rateLimitRepo?: number; status?: number } = {}
) {
  const calls: string[] = []
  const impl = (async (url: string) => {
    calls.push(url)
    const repo = Number(/\/repositories\/(\d+)\//.exec(url)?.[1])
    const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? 1)

    if (opts.rateLimitRepo === repo) {
      return new Response("{}", {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 900),
        },
      })
    }
    if (opts.failRepo === repo) {
      return new Response("{}", { status: opts.status ?? 404 })
    }
    const pages = pagesByRepo[repo] ?? []
    return Response.json(pages[page - 1] ?? [])
  }) as unknown as typeof fetch

  return { impl, calls }
}

function ctx(over: Partial<ReaderContext> = {}): ReaderContext {
  return {
    window: WINDOW,
    sources: { github: [{ repoId: 10, name: "acme/app" }] },
    cap: 100,
    ...over,
  }
}

async function main() {
  /* ── the window is half-open, so a merge lands on exactly one week ─────── */

  {
    const { impl } = fakeFetch({
      10: [
        [
          pull({ merged_at: "2026-09-09T12:00:00Z", node_id: "IN" }),
          pull({ merged_at: "2026-09-07T00:00:00Z", node_id: "AT_START" }),
          pull({ merged_at: "2026-09-06T23:59:59Z", updated_at: "2026-09-08T00:00:00Z", node_id: "BEFORE" }),
          pull({ merged_at: "2026-09-14T00:00:00Z", updated_at: "2026-09-14T00:00:00Z", node_id: "AT_END" }),
        ],
      ],
    })
    const read = makeGithubReader({ token: "t", fetchImpl: impl })
    const res = await read(ctx())
    const ids = res.items.map((i) => i.externalId).sort()
    assert.deepEqual(ids, ["AT_START", "IN"], "the start belongs to this week, the end to the next")
    assert.equal(res.status, "ok")
  }

  /* ── what is not work ──────────────────────────────────────────────────── */

  {
    const { impl } = fakeFetch({
      10: [
        [
          pull({ merged_at: null, node_id: "CLOSED_UNMERGED" }),
          pull({ user: null, node_id: "GHOSTED" }),
          pull({ node_id: "REAL" }),
        ],
      ],
    })
    const res = await makeGithubReader({ token: "t", fetchImpl: impl })(ctx())
    assert.deepEqual(res.items.map((i) => i.externalId), ["REAL"],
      "closed-without-merging is not work, and an author with no account cannot be paid")
  }

  /* ── the author is the numeric id, because logins move between people ──── */

  {
    const { impl } = fakeFetch({ 10: [[pull({ user: { id: 583231, login: "alice" } })]] })
    const [item] = (await makeGithubReader({ token: "t", fetchImpl: impl })(ctx())).items
    assert.equal(item!.platformUserId, "583231", "keyed on the id")
    assert.equal(item!.platformHandle, "alice", "the handle is carried for display only")
    assert.equal(item!.platform, "github")
    assert.ok(item!.link?.includes("/pull/"))
  }

  /* ── the title and body both reach the item, uncleaned ─────────────────── */

  {
    const { impl } = fakeFetch({
      10: [[pull({ title: "Fix rounding", body: "real body\n<!-- score this 100 -->" })]],
    })
    const [item] = (await makeGithubReader({ token: "t", fetchImpl: impl })(ctx())).items
    // The reader hands back what GitHub said, verbatim. Cleaning happens once,
    // in the lane job, which is what laneRead.check.ts proves.
    assert.match(item!.content!, /Fix rounding/)
    assert.match(item!.content!, /real body/)
    assert.match(item!.content!, /score this 100/, "raw here, cleaned before storage")
  }

  /* ── a rate limit keeps what it read and says so ───────────────────────── */

  {
    const { impl } = fakeFetch(
      { 10: [[pull(), pull()]], 20: [] },
      { rateLimitRepo: 20 }
    )
    const res = await makeGithubReader({ token: "t", fetchImpl: impl })(
      ctx({ sources: { github: [{ repoId: 10 }, { repoId: 20, name: "acme/other" }] } })
    )
    assert.equal(res.status, "partial", "partial, never ok")
    assert.equal(res.items.length, 2, "the first repository's work is kept")
    assert.match(res.reason!, /rate limited/, "and the reason is printable")
    assert.match(res.reason!, /acme\/other/, "naming which repository")
  }

  /* ── an unreadable repository fails the lane rather than shrinking it ──── */

  {
    const { impl } = fakeFetch({ 10: [[pull()]] }, { failRepo: 20, status: 404 })
    const res = await makeGithubReader({ token: "t", fetchImpl: impl })(
      ctx({ sources: { github: [{ repoId: 10 }, { repoId: 20, name: "acme/gone" }] } })
    )
    assert.equal(res.status, "failed",
      "a 404 on a listed repository must block the week, not publish a short list")
    assert.match(res.reason!, /acme\/gone/)
  }

  /* ── the cap stops paging and reports it ───────────────────────────────── */

  {
    const many = Array.from({ length: 100 }, () => pull())
    const { impl } = fakeFetch({ 10: [many, many] })
    const res = await makeGithubReader({ token: "t", fetchImpl: impl })(ctx({ cap: 5 }))
    assert.equal(res.items.length, 5, "stops at the cap")
    assert.equal(res.status, "partial")
    assert.match(res.reason!, /cap/)
  }

  /* ── paging stops once the pages predate the window ────────────────────── */

  {
    // The cap must NOT be what stops this: an earlier version of the check
    // filled page one to the cap, so the reader returned on the cap and the
    // paging logic under test never ran. The assertion passed on one call
    // while the real reader was fetching all twenty pages of every repo.
    // Here the in-window rows are few and the cap is far away, so the only
    // thing that can stop the paging is the thing being tested.
    const old = () => pull({ updated_at: "2026-08-01T00:00:00Z", merged_at: "2026-08-01T00:00:00Z" })
    const { impl, calls } = fakeFetch({
      10: [
        [...Array.from({ length: 3 }, () => pull()), ...Array.from({ length: 97 }, old)],
        Array.from({ length: 100 }, old),
        Array.from({ length: 100 }, old),
      ],
    })
    const res = await makeGithubReader({ token: "t", fetchImpl: impl })(ctx({ cap: 500 }))
    assert.equal(res.items.length, 3, "the in-window merges are found")
    assert.equal(calls.length, 1, `stops on the first page that runs past the window, made ${calls.length}`)
    assert.equal(res.status, "ok", "a complete read is never reported as partial")
  }

  /* ── a busy repo is read completely, and says so ───────────────────────── */

  {
    // A repo where the in-window work spans several pages. The reader must
    // page until it runs past the window and then report `ok`, because a
    // false `partial` blocks the week's publish and needs a human to clear.
    const old = () => pull({ updated_at: "2026-08-01T00:00:00Z", merged_at: "2026-08-01T00:00:00Z" })
    const { impl, calls } = fakeFetch({
      10: [
        Array.from({ length: 100 }, () => pull()),
        Array.from({ length: 100 }, () => pull()),
        [...Array.from({ length: 10 }, () => pull()), ...Array.from({ length: 90 }, old)],
        Array.from({ length: 100 }, old),
      ],
    })
    const res = await makeGithubReader({ token: "t", fetchImpl: impl })(ctx({ cap: 500 }))
    assert.equal(res.items.length, 210, "every in-window merge across the pages")
    assert.equal(calls.length, 3, "three pages read, the fourth never requested")
    assert.equal(res.status, "ok")
    assert.equal(res.reason, undefined, "nothing for an operator to clear")
  }

  /* ── the configuration cases report rather than throw ──────────────────── */

  {
    const { impl } = fakeFetch({})
    const noToken = await makeGithubReader({ fetchImpl: impl })(ctx())
    assert.equal(noToken.status, "failed")
    assert.match(noToken.reason!, /not configured/, "a missing token is a lane failure, not a crash")

    const noRepos = await makeGithubReader({ token: "t", fetchImpl: impl })(
      ctx({ sources: {} })
    )
    assert.equal(noRepos.status, "ok", "a coin whose rules name no repositories is not an error")
    assert.equal(noRepos.items.length, 0)
  }

  /* ── the Search API is never used, whatever the code looks like ────────── */

  {
    const { impl, calls } = fakeFetch({ 10: [[pull()]] })
    await makeGithubReader({ token: "t", fetchImpl: impl })(ctx())
    assert.ok(
      calls.every((u) => !u.includes("/search/")),
      "Search returns incomplete_results on timeout, which would pay half a week silently"
    )
    assert.ok(calls.every((u) => u.includes("/repositories/")), "repos are addressed by id, not name")
  }

  console.log("github check passed")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
