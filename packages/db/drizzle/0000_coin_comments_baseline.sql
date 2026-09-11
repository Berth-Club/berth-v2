-- BASELINE. Hand-edited for idempotency, before it was ever applied.
--
-- This migration adopts a table Drizzle did not create. The pre-Drizzle code
-- built `coin_comments` from a web request via CREATE TABLE IF NOT EXISTS on
-- first use, and later added `balance` the same way with ALTER TABLE ... ADD
-- COLUMN IF NOT EXISTS. So a deployed database can be in any of three states,
-- and this file is a no-op or a repair in each:
--
--   1. fresh/empty            -> CREATE builds all six columns, ALTER no-ops
--   2. table with balance     -> both no-op (current production)
--   3. table without balance  -> CREATE no-ops, ALTER adds the column
--
-- Without the IF NOT EXISTS guards, the first `drizzle-kit migrate` against
-- production dies on "relation already exists" and no later migration can run.
-- The redundant-looking ALTER is what covers state 3: CREATE TABLE IF NOT
-- EXISTS will not add a column to a table that already exists.
--
-- Do NOT copy this pattern into new migrations — generate them and leave the
-- SQL alone. This exception exists only to adopt the pre-Drizzle table.
CREATE TABLE IF NOT EXISTS "coin_comments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "coin_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"coin" text NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"balance" text
);
--> statement-breakpoint
ALTER TABLE "coin_comments" ADD COLUMN IF NOT EXISTS "balance" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coin_comments_coin_idx" ON "coin_comments" USING btree ("coin","created_at" desc);
