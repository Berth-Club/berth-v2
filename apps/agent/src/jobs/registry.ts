import { laneRead } from "./laneRead.js"
import type { JobHandler } from "./types.js"

/**
 * Every job type this worker knows how to run.
 *
 * A type with no entry here is parked rather than retried: an unrecognised job
 * means a deploy is missing code, and spinning on it would hide that.
 *
 * Handlers land here as the units that own them are built. The epoch clock, the
 * readers, the scorer and the keeper each register their own.
 */
export const handlers: Record<string, JobHandler> = {
  /**
   * A job that does nothing, so the worker can be proved to boot, claim and
   * complete before any real handler exists. Seed one with:
   *   insert into hm_jobs (type, coin, epoch, status) values ('noop', '0x00…00', 0, 'pending');
   */
  noop: async ({ job }) => ({ kind: "done", note: `noop ${job.id}` }),

  /** Read one lane for one coin for one week. `key` is the lane name. */
  lane_read: laneRead,
}

/**
 * How long each type may hold its lease, where the default of two minutes is
 * wrong. A scoring batch waits on a model; a lane read waits on a rate limit.
 */
export const leaseSeconds: Record<string, number> = {
  // Paging several repositories, with a rate limit in the way, takes longer
  // than the two-minute default before it is genuinely stuck.
  lane_read: 10 * 60,
}
