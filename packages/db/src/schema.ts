import { desc, sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

/**
 * Every table the WEB APP and the AGENT own, on the app's Postgres.
 *
 * The indexer OWNS its own tables (Ponder creates and drops them on every
 * reindex); nothing here may reference them, and `drizzle.config.ts` pins
 * `tablesFilter` so drizzle-kit never sees — let alone proposes dropping —
 * anything Ponder created. Add every new table to that list in the same commit.
 *
 * NO `server-only` import in this file: drizzle-kit loads it in a plain Node
 * process to diff the schema, and `server-only` would throw there. The agent
 * also imports it directly, outside Next entirely.
 *
 * Money columns are `numeric(78, 0)`, never bigint: a uint256 is 78 digits and
 * int8 overflows at 9.2e18, which is nine USDC at 18dp. Read them as strings
 * and parse to BigInt at the edge.
 */

/* ─────────────────────────── existing web tables ─────────────────────────── */

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

/* ───────────────────────────── harbormaster ──────────────────────────────── */

/**
 * The berth wallet for a Privy user, PINNED on first write and never
 * recomputed.
 *
 * `linkedAccounts` order is not stable — a user can unlink and relink wallets,
 * which moves the "first wallet" the existing routes read. Every Harbormaster
 * check (who deployed this coin, whose dispute cap is this, which wallet does
 * this payout belong to) compares against this row instead, so the answer
 * cannot drift underneath a payout.
 */
export const hmUsers = pgTable(
  "hm_users",
  {
    /** Privy DID, e.g. `did:privy:…`. */
    did: text("did").primaryKey(),
    /** Lowercased 0x address. Validated as an EVM address before it is written. */
    wallet: text("wallet").notNull().unique(),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("hm_users_wallet_lower", sql`${t.wallet} = lower(${t.wallet})`)]
)

/**
 * One row per coin that launched with Harbormaster on.
 *
 * `currentVersionId` is a pointer, not the source of truth: an epoch reads the
 * version whose `effectiveFromEpoch` has arrived, so an edit made today cannot
 * change how this week is scored.
 */
export const hmRules = pgTable(
  "hm_rules",
  {
    /** Lowercased token address. */
    coin: text("coin").primaryKey(),
    /** The wallet that deployed it, from `hm_users`. Only this wallet may edit. */
    deployer: text("deployer").notNull(),
    currentVersionId: bigint("current_version_id", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("hm_rules_coin_lower", sql`${t.coin} = lower(${t.coin})`)]
)

/**
 * An immutable version of one coin's scoring rules.
 *
 * Frozen by the database once `confirmedAt` is set (see the trigger migration):
 * an epoch stores only a reference to the row, and the whole "the rules could
 * not have changed after the work was read" claim rests on the row never
 * changing. `sources` holds the ids the agent extracted (repo ids, FOMO page
 * ids), never handles, because a handle can be renamed onto someone else.
 */
export const hmRuleVersions = pgTable(
  "hm_rule_versions",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    coin: text("coin").notNull(),
    versionNo: integer("version_no").notNull(),
    /** What the creator wrote, verbatim. Rendered as text, never as markup. */
    body: text("body").notNull(),
    /** `{ github: [{repoId, name}], fomo: [{pageId}] }` as resolved at confirm. */
    sources: jsonb("sources").notNull(),
    /** The agent's reading of what counts and what it is worth, shown back before launch. */
    reading: jsonb("reading"),
    /** First epoch index this version applies to. */
    effectiveFromEpoch: integer("effective_from_epoch").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("hm_rule_versions_coin_no").on(t.coin, t.versionNo),
    // Two edits in one week cannot both claim the next epoch.
    uniqueIndex("hm_rule_versions_coin_epoch").on(t.coin, t.effectiveFromEpoch),
  ]
)

/**
 * Rules written in the launch wizard BEFORE the token address exists.
 *
 * The address is only known from the launch receipt, so the wizard writes a
 * draft at confirm time and binds it afterwards. Keyed by the pinned wallet;
 * `boundCoin` is set exactly once, which is what makes bind one-shot.
 */
export const hmRuleDrafts = pgTable(
  "hm_rule_drafts",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    wallet: text("wallet").notNull(),
    body: text("body").notNull(),
    sources: jsonb("sources"),
    reading: jsonb("reading"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    boundCoin: text("bound_coin").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("hm_rule_drafts_wallet_idx").on(t.wallet, desc(t.createdAt))]
)

/**
 * A platform account proved to belong to a berth wallet.
 *
 * Keyed on the platform's IMMUTABLE id (GitHub's numeric user id, FOMO's
 * account id), never a handle: GitHub releases usernames on rename and delete,
 * so a handle-keyed binding would let a squatter inherit someone's unclaimed
 * payouts. One platform account binds to one wallet, and one wallet holds at
 * most one account per platform.
 */
export const hmBindings = pgTable(
  "hm_bindings",
  {
    /** `github` | `fomo`. */
    platform: text("platform").notNull(),
    /** The provider's immutable id for the account. */
    subject: text("subject").notNull(),
    /** Display handle at bind time. Informational only; never joined on. */
    handle: text("handle"),
    wallet: text("wallet").notNull(),
    boundAt: timestamp("bound_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("hm_bindings_pk").on(t.platform, t.subject),
    uniqueIndex("hm_bindings_platform_wallet").on(t.platform, t.wallet),
  ]
)

/**
 * One row per coin per week.
 *
 * `state` is written only by the agent, and only by a conditional update that
 * names the state it expects to replace, so two timers firing together cannot
 * both advance it. The frozen columns (`rulesVersionId`, `promptHash`,
 * `modelId`) are what make a score checkable later: they say exactly which
 * rules and which prompt produced it.
 */
export const hmEpochs = pgTable(
  "hm_epochs",
  {
    coin: text("coin").notNull(),
    epoch: integer("epoch").notNull(),
    state: text("state").notNull(),
    rulesVersionId: bigint("rules_version_id", { mode: "bigint" }),
    promptHash: text("prompt_hash"),
    modelId: text("model_id"),
    /** Start of the window the readers pull. Wider than the epoch for a first-epoch lookback. */
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** End of the current dispute clock: 48h on publish, 24h after a repost. */
    clockEnd: timestamp("clock_end", { withTimezone: true }),
    /** Hard stop regardless of disputes: publish + 72h, bounded by epoch end + 7d. */
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    /** Set when the payout is on chain. The freeze trigger reads this. */
    postedAt: timestamp("posted_at", { withTimezone: true }),
    /** Canonical bytes of the published list, and the keeper's signature over them. */
    canonicalHash: text("canonical_hash"),
    signature: text("signature"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("hm_epochs_pk").on(t.coin, t.epoch),
    index("hm_epochs_state_idx").on(t.state, t.createdAt),
    check(
      "hm_epochs_state_valid",
      sql`${t.state} in ('rules_missing','collecting','reads_pending','scoring','scoring_delayed',
        'published','reposted','settled','root_posting','posting_failed','root_posted',
        'expired','abandoned','no_root','needs_operator')`
    ),
  ]
)

/**
 * How one lane fared in one week.
 *
 * The point of this table is that a lane which could not be read NEVER looks
 * like a quiet week. `status` is checked before an epoch may publish, and a
 * `skipped` row must carry who skipped it and why, because that reason is
 * printed on the public list.
 */
export const hmLaneReads = pgTable(
  "hm_lane_reads",
  {
    coin: text("coin").notNull(),
    epoch: integer("epoch").notNull(),
    /** `github` | `fomo`. */
    lane: text("lane").notNull(),
    status: text("status").notNull(),
    reason: text("reason"),
    /** Wallet of the operator who skipped or accepted a partial read. */
    operator: text("operator"),
    itemCount: integer("item_count").notNull().default(0),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("hm_lane_reads_pk").on(t.coin, t.epoch, t.lane),
    check("hm_lane_reads_status", sql`${t.status} in ('pending','ok','partial','failed','skipped')`),
    check(
      "hm_lane_reads_skip_has_reason",
      sql`${t.status} <> 'skipped' or (${t.operator} is not null and ${t.reason} is not null)`
    ),
  ]
)

/**
 * One piece of work read from one lane.
 *
 * `content` is attacker-authored text and is the ONLY erasable column on a
 * frozen row: X and FOMO can require a takedown, and an author can ask for
 * their unbound line to be removed. Everything else about the item stays, so
 * a past payout remains checkable.
 *
 * `originItemId` points at last week's unbound item when this one is a rescore
 * of it, and its unique index is what stops an item being carried twice.
 */
export const hmItems = pgTable(
  "hm_items",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    coin: text("coin").notNull(),
    epoch: integer("epoch").notNull(),
    lane: text("lane").notNull(),
    platform: text("platform").notNull(),
    /** The platform's immutable id for the author. Joined to `hm_bindings`. */
    platformUserId: text("platform_user_id").notNull(),
    /** Handle at read time. Shown on an unclaimed line. Never joined on. */
    platformHandle: text("platform_handle"),
    /** The platform's id for the item itself (PR node id, callout id). */
    externalId: text("external_id").notNull(),
    link: text("link"),
    /** Erasable. NULL once scrubbed; `contentRemovedAt` says when. */
    content: text("content"),
    contentHash: text("content_hash"),
    contentRemovedAt: timestamp("content_removed_at", { withTimezone: true }),
    /** Bytes removed by hygiene (HTML comments, non-printing unicode). */
    strippedBytes: integer("stripped_bytes").notNull().default(0),
    status: text("status").notNull(),
    originItemId: bigint("origin_item_id", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("hm_items_external").on(t.coin, t.epoch, t.lane, t.externalId),
    uniqueIndex("hm_items_origin").on(t.originItemId),
    index("hm_items_epoch_idx").on(t.coin, t.epoch),
    index("hm_items_author_idx").on(t.platform, t.platformUserId),
    check(
      "hm_items_status",
      sql`${t.status} in ('pending','scored','unbound','unscored_cap','removed')`
    ),
  ]
)

/**
 * A verdict on one item.
 *
 * Keyed by `(item, round)` rather than by item alone so a rescore never
 * overwrites the original: the record page shows both, which is how a reader
 * checks that a disputed pull actually changed something. Round 0 is the
 * weekly run, round 1 the rescore; the unique index is what enforces "one
 * rescore per line per repost".
 */
export const hmScores = pgTable(
  "hm_scores",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    itemId: bigint("item_id", { mode: "bigint" }).notNull(),
    round: integer("round").notNull(),
    median: integer("median").notNull(),
    reason: text("reason").notNull(),
    /** Item ids the model cited. A verdict citing anything outside the set is rejected. */
    cited: jsonb("cited"),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("hm_scores_item_round").on(t.itemId, t.round),
    check("hm_scores_round", sql`${t.round} in (0, 1)`),
    check("hm_scores_median", sql`${t.median} >= 0 and ${t.median} <= 100`),
    check(
      "hm_scores_status",
      sql`${t.status} in ('scored','pulled','unscored_cap','rejected_output','excluded')`
    ),
  ]
)

/**
 * One model call, stored so a disputed verdict can be checked.
 *
 * The request is reconstructable rather than embedded: item id plus content
 * hash plus rules version, with the system prompt public. That keeps one copy
 * of the attacker-authored text (on the item, where it is erasable) instead of
 * two.
 */
export const hmAudit = pgTable(
  "hm_audit",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    itemId: bigint("item_id", { mode: "bigint" }).notNull(),
    round: integer("round").notNull(),
    sampleIdx: integer("sample_idx").notNull(),
    modelId: text("model_id").notNull(),
    promptHash: text("prompt_hash").notNull(),
    schemaHash: text("schema_hash").notNull(),
    contentHash: text("content_hash"),
    rulesVersionId: bigint("rules_version_id", { mode: "bigint" }),
    /** The model's raw reply, before parsing. */
    rawResponse: text("raw_response"),
    parsed: jsonb("parsed"),
    usage: jsonb("usage"),
    providerRequestId: text("provider_request_id"),
    /** Set on a rescore: which dispute prompted it, and a hash of its body. */
    challengeId: bigint("challenge_id", { mode: "bigint" }),
    challengeBodyHash: text("challenge_body_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("hm_audit_sample").on(t.itemId, t.round, t.sampleIdx),
    index("hm_audit_item_idx").on(t.itemId),
  ]
)

/**
 * Someone arguing with a line.
 *
 * The partial unique index allows one OPEN dispute per wallet per line while
 * still allowing a second after the first is answered. Caps (per wallet per
 * epoch, per line) are counted inside the insert transaction, not expressed
 * here, because they are policy rather than structure.
 */
export const hmChallenges = pgTable(
  "hm_challenges",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    itemId: bigint("item_id", { mode: "bigint" }).notNull(),
    /** Denormalised so cap counts and window checks need no join. */
    coin: text("coin").notNull(),
    epoch: integer("epoch").notNull(),
    wallet: text("wallet").notNull(),
    /** Erasable, same as item content. */
    body: text("body"),
    status: text("status").notNull(),
    verdictReason: text("verdict_reason"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("hm_challenges_one_open")
      .on(t.itemId, t.wallet)
      .where(sql`status = 'open'`),
    index("hm_challenges_epoch_idx").on(t.coin, t.epoch),
    check(
      "hm_challenges_status",
      sql`${t.status} in ('open','upheld','rejected','answered_after_settlement')`
    ),
  ]
)

/**
 * The merkle tree behind one epoch's payout.
 *
 * `dump` is the serialised tree, kept so proofs can be served for as long as
 * claims are open without rebuilding anything. `root` is unique across the
 * whole table: the leaf encoding includes the coin and the epoch, so two
 * epochs sharing a root means the builder read the wrong rows, and this turns
 * that into a failed insert rather than a posted root nobody can claim.
 */
export const hmTrees = pgTable(
  "hm_trees",
  {
    coin: text("coin").notNull(),
    epoch: integer("epoch").notNull(),
    root: text("root").notNull(),
    dump: jsonb("dump").notNull(),
    /** The balance the 1% cap was measured against, so the amounts can be audited. */
    vaultBalanceAtBuild: numeric("vault_balance_at_build", { precision: 78, scale: 0 }),
    coinTotal: numeric("coin_total", { precision: 78, scale: 0 }).notNull(),
    usdcTotal: numeric("usdc_total", { precision: 78, scale: 0 }).notNull(),
    builtAt: timestamp("built_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("hm_trees_pk").on(t.coin, t.epoch),
    uniqueIndex("hm_trees_root").on(t.root),
    check("hm_trees_totals", sql`${t.coinTotal} >= 0 and ${t.usdcTotal} >= 0`),
  ]
)

/**
 * What one wallet is owed for one epoch on one coin.
 *
 * `wallet` is a COPY, never a foreign key to `hm_bindings`: the leaf records
 * who was bound at build time, and a later binding change must not move money
 * that is already committed to a root.
 */
export const hmLeaves = pgTable(
  "hm_leaves",
  {
    coin: text("coin").notNull(),
    epoch: integer("epoch").notNull(),
    wallet: text("wallet").notNull(),
    coinAmount: numeric("coin_amount", { precision: 78, scale: 0 }).notNull(),
    usdcAmount: numeric("usdc_amount", { precision: 78, scale: 0 }).notNull(),
    leafIndex: integer("leaf_index").notNull(),
  },
  (t) => [
    uniqueIndex("hm_leaves_pk").on(t.coin, t.epoch, t.wallet),
    uniqueIndex("hm_leaves_index").on(t.coin, t.epoch, t.leafIndex),
    check(
      "hm_leaves_amounts",
      sql`${t.coinAmount} >= 0 and ${t.usdcAmount} >= 0
        and (${t.coinAmount} > 0 or ${t.usdcAmount} > 0)`
    ),
  ]
)

/**
 * Every transaction the keeper sends, written BEFORE it is broadcast.
 *
 * This row is the idempotency guard, not the chain: a crash between sending and
 * recording would otherwise let a retry send a second USDC deposit, which the
 * vault would happily accept. Retrying rebroadcasts `rawTx` and waits on the
 * same hash, so "did I already send this" is answered locally.
 */
export const hmKeeperTxs = pgTable(
  "hm_keeper_txs",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    /** `usdc_deposit` | `post_root` | `sweep`. */
    kind: text("kind").notNull(),
    coin: text("coin").notNull(),
    epoch: integer("epoch").notNull(),
    nonce: integer("nonce").notNull(),
    hash: text("hash").notNull(),
    /** The signed transaction, so a retry sends the same bytes. */
    rawTx: text("raw_tx").notNull(),
    receiptStatus: text("receipt_status"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("hm_keeper_txs_kind").on(t.kind, t.coin, t.epoch),
    uniqueIndex("hm_keeper_txs_hash").on(t.hash),
  ]
)

/**
 * How the weekly USDC pot was divided across coins.
 *
 * `status` matters as much as the amount: a pending allocation for an epoch
 * that has not settled must be subtracted from next week's pot, or the same
 * dollars get promised twice. `abandoned` and `no_root` epochs release theirs.
 */
export const hmUsdcSplits = pgTable(
  "hm_usdc_splits",
  {
    epoch: integer("epoch").notNull(),
    coin: text("coin").notNull(),
    /** The coin's raw fee total for the week, which sets its share. */
    feeShare: numeric("fee_share", { precision: 78, scale: 0 }).notNull(),
    amount: numeric("amount", { precision: 78, scale: 0 }).notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("hm_usdc_splits_pk").on(t.epoch, t.coin),
    check("hm_usdc_splits_status", sql`${t.status} in ('pending','deposited','released')`),
    check("hm_usdc_splits_amount", sql`${t.amount} >= 0 and ${t.feeShare} >= 0`),
  ]
)

/**
 * The agent's work queue.
 *
 * `key` is what makes the unique index usable: `lane_read` needs one row per
 * lane and `rescore_batch` one per round, so a key of just `(type, coin, epoch)`
 * would collapse them into one. Global jobs use the zero address for `coin`
 * rather than NULL, because NULLs are distinct in a unique index and would let
 * duplicates through.
 *
 * `lockUntil` is a lease, not a lock: a worker that dies mid-handler leaves the
 * row claimable again once it expires, and handlers are written so a late write
 * from the abandoned run is refused by a conditional update.
 */
export const hmJobs = pgTable(
  "hm_jobs",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    type: text("type").notNull(),
    coin: text("coin").notNull(),
    epoch: integer("epoch").notNull(),
    /** Lane name, round number, or '' — whatever makes this job distinct. */
    key: text("key").notNull().default(""),
    status: text("status").notNull(),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    lockedBy: text("locked_by"),
    lockUntil: timestamp("lock_until", { withTimezone: true }),
    /** Redacted before it is written: no URLs, no bearer values, no item text. */
    lastError: text("last_error"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("hm_jobs_identity").on(t.type, t.coin, t.epoch, t.key),
    index("hm_jobs_due_idx").on(t.status, t.runAfter),
    check(
      "hm_jobs_status",
      sql`${t.status} in ('pending','running','done','failed','needs_operator')`
    ),
  ]
)

/**
 * Every wallet address a contributor has ever written in their own work.
 *
 * The binding itself is one row in `hm_bindings` and is permanent. This table
 * is the evidence behind it and, more importantly, the evidence behind every
 * address that was NOT honoured: a checksum that failed, a second address that
 * appeared after the account was already bound, a wallet another account had
 * claimed first.
 *
 * Without this, "why was I not paid" has no answer anyone can check. The first
 * claim that succeeds says `bound`; everything after it says why not, and both
 * the contributor and an operator can read it.
 */
export const hmWalletClaims = pgTable(
  "hm_wallet_claims",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    platform: text("platform").notNull(),
    /** The platform's immutable id for the author, same key as `hm_bindings`. */
    subject: text("subject").notNull(),
    /** Lowercased. NULL when the text carried no usable address. */
    wallet: text("wallet"),
    /** The item the claim was read from, so it can be pointed at. */
    itemId: bigint("item_id", { mode: "bigint" }),
    coin: text("coin"),
    epoch: integer("epoch"),
    status: text("status").notNull(),
    /** Printable: what was seen and why it was or was not used. */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per (item, wallet), not per item. A lane re-read of an unchanged
    // body must not pile up duplicates, but a body EDITED to name a different
    // address has to leave a row: that edit is the attack this table exists to
    // make visible, and keying on the item alone would swallow it.
    uniqueIndex("hm_wallet_claims_item_wallet").on(t.itemId, t.wallet),
    index("hm_wallet_claims_subject").on(t.platform, t.subject),
    check(
      "hm_wallet_claims_status",
      sql`${t.status} in ('bound','already_bound_same','ignored_locked',
        'rejected_checksum','rejected_several','rejected_unpayable','wallet_taken')`
    ),
  ]
)

/** Wallets allowed to skip a lane, accept a partial read, or retry a stuck job. */
export const hmOperators = pgTable("hm_operators", {
  wallet: text("wallet").primaryKey(),
  note: text("note"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Single-use challenges for a wallet-signature binding.
 *
 * Burned by a conditional update (`used_at is null and expires_at > now()`)
 * rather than a select-then-update, because the read-then-write version is a
 * race two concurrent verifies can both win.
 */
export const hmNonces = pgTable("hm_nonces", {
  nonce: text("nonce").primaryKey(),
  /** Hash of the exact message we issued, so the signed bytes can be checked against it. */
  messageHash: text("message_hash").notNull(),
  did: text("did").notNull(),
  wallet: text("wallet").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

/** Everything drizzle-kit and the query builders need in one object. */
export const schema = {
  coinComments,
  userProfiles,
  hmUsers,
  hmRules,
  hmRuleVersions,
  hmRuleDrafts,
  hmBindings,
  hmEpochs,
  hmLaneReads,
  hmItems,
  hmScores,
  hmAudit,
  hmChallenges,
  hmTrees,
  hmLeaves,
  hmKeeperTxs,
  hmUsdcSplits,
  hmJobs,
  hmWalletClaims,
  hmOperators,
  hmNonces,
}

/** Kept in sync with `tablesFilter` in drizzle.config.ts. */
export const TABLE_NAMES = [
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
  "hm_wallet_claims",
  "hm_operators",
  "hm_nonces",
] as const

/** Epoch states, in the order an epoch moves through them. */
export const EPOCH_STATES = [
  "rules_missing",
  "collecting",
  "reads_pending",
  "scoring",
  "scoring_delayed",
  "published",
  "reposted",
  "settled",
  "root_posting",
  "posting_failed",
  "root_posted",
  "expired",
  "abandoned",
  "no_root",
  "needs_operator",
] as const

export type EpochState = (typeof EPOCH_STATES)[number]

/** The lanes this phase ships. X and pump.fun join later, same event shape. */
export const LANES = ["github", "fomo"] as const
export type Lane = (typeof LANES)[number]
