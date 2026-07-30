import { desc } from "drizzle-orm"
import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core"

/**
 * Tables the WEB APP owns, on the same Railway Postgres the indexer uses.
 *
 * The indexer OWNS its own tables (Ponder manages them); nothing here may
 * reference them, and `drizzle.config.ts` pins `tablesFilter` so drizzle-kit
 * never sees — let alone proposes dropping — anything Ponder created.
 *
 * NO `server-only` import in this file: drizzle-kit loads it in a plain Node
 * process to diff the schema, and `server-only` would throw there.
 */

export const coinComments = pgTable(
  "coin_comments",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    coin: text("coin").notNull(),
    author: text("author").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Snapshot of the poster's holding of this coin at post time, pre-formatted
     * (e.g. "22k"). Nullable on purpose: rows written before the column existed,
     * and posts where the balance read failed, legitimately have none.
     */
    balance: text("balance"),
  },
  (t) => [index("coin_comments_coin_idx").on(t.coin, desc(t.createdAt))]
)

/**
 * Editable off-chain identity for a wallet. Keyed by the LOWERCASED address, so
 * every surface can resolve `wallet -> {name, avatar, …}` with a plain lookup.
 * All content columns are nullable: a profile with only an avatar, or only a
 * name, is valid, and a wallet with no row at all just falls back to its derived
 * identity (generated avatar + short address).
 */
export const userProfiles = pgTable("user_profiles", {
  wallet: text("wallet").primaryKey(),
  name: text("name"),
  bio: text("bio"),
  /** A single http(s) URL (e.g. an X profile). */
  social: text("social"),
  /** Uploaded avatar as `ipfs://CID`, same shape as a coin's image. */
  image: text("image"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
