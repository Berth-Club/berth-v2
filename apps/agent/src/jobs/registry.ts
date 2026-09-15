import { epochStart } from "./epochStart.js"
import { venueRead } from "./venueRead.js"
import { publish } from "./publish.js"
import { scoreBatch } from "./scoreBatch.js"
import type { JobHandler } from "./types.js"

/**
 * Every job type this worker knows how to run.
 *
 * A type with no entry here is parked rather than retried: an unrecognised job
 * means a deploy is missing code, and spinning on it would hide that.
 *
 * There is no dependency graph. Each handler waits on its own preconditions, so
 * the types below can all be queued the moment a week opens and sort themselves
 * out: the scorer waits for venues to report, the publisher waits for every item
 * to be judged. A job that runs too early costs one cheap poll. A graph that
 * gets the order wrong costs a stuck week nobody notices.
 */
export const handlers: Record<string, JobHandler> = {
  /**
   * A job that does nothing, so the worker can be proved to boot, claim and
   * complete before any real handler exists. Seed one with:
   *   insert into hm_jobs (type, coin, epoch, status) values ('noop', '0x00…00', 0, 'pending');
   */
  noop: async ({ job }) => ({ kind: "done", note: `noop ${job.id}` }),

  /** Open the week that just closed and queue its work. Global, not per coin. */
  epoch_start: epochStart,

  /** Read one venue for one coin for one week. `key` is the venue name. */
  venue_read: venueRead,

  /** Score the week's unjudged items, resumably, in batches. */
  score_batch: scoreBatch,

  /** Turn the scores into the list of who is owed what. */
  publish,
}

/**
 * How long each type may hold its lease, where the default of two minutes is
 * wrong. A scoring batch waits on a model; a venue read waits on a rate limit.
 */
export const leaseSeconds: Record<string, number> = {
  // Paging several repositories, with a rate limit in the way, takes longer
  // than the two-minute default before it is genuinely stuck.
  venue_read: 10 * 60,

  // Twenty-five items, each a model call that can take tens of seconds. A
  // shorter lease would let a second worker start scoring items the first is
  // already paying for.
  score_batch: 20 * 60,
}
