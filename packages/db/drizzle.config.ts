import { defineConfig } from "drizzle-kit"

/**
 * drizzle-kit runs its own Node process and does not read the repo's `.env`,
 * so `db:migrate` would ask for a url that is sitting right there. The agent's
 * scripts get it through `--env-file-if-exists`, which is not a thing a config
 * file can opt into, hence doing it by hand.
 *
 * Missing is fine and silent: on Railway the platform supplies the variables
 * and there is no file. Anything already in the environment wins, matching how
 * `--env-file-if-exists` behaves everywhere else in this repo.
 */
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url).pathname)
} catch {
  // No file, or no permission to read it. Either way the environment decides.
}

/**
 * drizzle-kit config for every table the web app and the agent own.
 *
 * `tablesFilter` is the safety rail, not a nicety: this database is shared with
 * the Ponder indexer, which creates and drops its own tables on every reindex.
 * Without the filter, `generate`/`push` would diff Ponder's tables against an
 * empty schema and emit DROP TABLE for all of them. Keep it in sync with
 * `TABLE_NAMES` in `src/schema.ts` when adding a table.
 *
 * Paths here resolve from the process working directory, not this file, so the
 * db:* scripts run from `packages/db`. The web app calls them with
 * `pnpm --filter @workspace/db db:migrate`.
 *
 * DATABASE_URL is only needed for `migrate`/`push`/`pull`; `generate` diffs the
 * TypeScript schema against ./drizzle/meta and works without a database.
 */
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  tablesFilter: [
    "coin_comments",
    "user_profiles",
    "hm_users",
    "hm_rules",
    "hm_rule_versions",
    "hm_rule_drafts",
    "hm_bindings",
    "hm_epochs",
    "hm_lane_reads",
    "hm_items",
    "hm_scores",
    "hm_audit",
    "hm_challenges",
    "hm_trees",
    "hm_leaves",
    "hm_keeper_txs",
    "hm_usdc_splits",
    "hm_jobs",
    "hm_fomo_callouts",
    "hm_fomo_users",
    "hm_wallet_claims",
    "hm_operators",
    "hm_nonces",
  ],
  strict: true,
  verbose: true,
})
