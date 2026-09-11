/**
 * The schema lives in `@workspace/db` so the agent can import the same
 * definitions without depending on the web app.
 *
 * This file stays as the import path the web app already uses everywhere, and
 * as the place drizzle-kit used to be pointed at. Migrations now run from the
 * package: `pnpm --filter @workspace/db db:generate` / `db:migrate`.
 */
export * from "@workspace/db/schema"
