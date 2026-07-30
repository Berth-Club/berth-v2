import { defineConfig } from "drizzle-kit"

/**
 * drizzle-kit config for the WEB APP's own tables.
 *
 * `tablesFilter` is the safety rail, not a nicety: this database is shared with
 * the Ponder indexer, which creates and drops its own tables on every reindex.
 * Without the filter, `generate`/`push` would diff Ponder's tables against an
 * empty schema and emit DROP TABLE for all of them. Keep it in sync with
 * `lib/db/schema.ts` when adding a table.
 *
 * DATABASE_URL is only needed for `migrate`/`push`/`pull`; `generate` diffs the
 * TypeScript schema against ./drizzle/meta and works without a database.
 */
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  tablesFilter: ["coin_comments", "user_profiles"],
  strict: true,
  verbose: true,
})
