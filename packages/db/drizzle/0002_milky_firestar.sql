CREATE TABLE "hm_audit" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hm_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"item_id" bigint NOT NULL,
	"round" integer NOT NULL,
	"sample_idx" integer NOT NULL,
	"model_id" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"schema_hash" text NOT NULL,
	"content_hash" text,
	"rules_version_id" bigint,
	"raw_response" text,
	"parsed" jsonb,
	"usage" jsonb,
	"provider_request_id" text,
	"challenge_id" bigint,
	"challenge_body_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hm_bindings" (
	"platform" text NOT NULL,
	"subject" text NOT NULL,
	"handle" text,
	"wallet" text NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hm_challenges" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hm_challenges_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"item_id" bigint NOT NULL,
	"coin" text NOT NULL,
	"epoch" integer NOT NULL,
	"wallet" text NOT NULL,
	"body" text,
	"status" text NOT NULL,
	"verdict_reason" text,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hm_challenges_status" CHECK ("hm_challenges"."status" in ('open','upheld','rejected','answered_after_settlement'))
);
--> statement-breakpoint
CREATE TABLE "hm_epochs" (
	"coin" text NOT NULL,
	"epoch" integer NOT NULL,
	"state" text NOT NULL,
	"rules_version_id" bigint,
	"prompt_hash" text,
	"model_id" text,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"published_at" timestamp with time zone,
	"clock_end" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"canonical_hash" text,
	"signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hm_epochs_state_valid" CHECK ("hm_epochs"."state" in ('rules_missing','collecting','reads_pending','scoring','scoring_delayed',
        'published','reposted','settled','root_posting','posting_failed','root_posted',
        'expired','abandoned','no_root','needs_operator'))
);
--> statement-breakpoint
CREATE TABLE "hm_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hm_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"coin" text NOT NULL,
	"epoch" integer NOT NULL,
	"lane" text NOT NULL,
	"platform" text NOT NULL,
	"platform_user_id" text NOT NULL,
	"platform_handle" text,
	"external_id" text NOT NULL,
	"link" text,
	"content" text,
	"content_hash" text,
	"content_removed_at" timestamp with time zone,
	"stripped_bytes" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"origin_item_id" bigint,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "hm_items_status" CHECK ("hm_items"."status" in ('pending','scored','unbound','unscored_cap','removed'))
);
--> statement-breakpoint
CREATE TABLE "hm_jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hm_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" text NOT NULL,
	"coin" text NOT NULL,
	"epoch" integer NOT NULL,
	"key" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_by" text,
	"lock_until" timestamp with time zone,
	"last_error" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hm_jobs_status" CHECK ("hm_jobs"."status" in ('pending','running','done','failed','needs_operator'))
);
--> statement-breakpoint
CREATE TABLE "hm_keeper_txs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hm_keeper_txs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"coin" text NOT NULL,
	"epoch" integer NOT NULL,
	"nonce" integer NOT NULL,
	"hash" text NOT NULL,
	"raw_tx" text NOT NULL,
	"receipt_status" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hm_lane_reads" (
	"coin" text NOT NULL,
	"epoch" integer NOT NULL,
	"lane" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"operator" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "hm_lane_reads_status" CHECK ("hm_lane_reads"."status" in ('pending','ok','partial','failed','skipped')),
	CONSTRAINT "hm_lane_reads_skip_has_reason" CHECK ("hm_lane_reads"."status" <> 'skipped' or ("hm_lane_reads"."operator" is not null and "hm_lane_reads"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "hm_leaves" (
	"coin" text NOT NULL,
	"epoch" integer NOT NULL,
	"wallet" text NOT NULL,
	"coin_amount" numeric(78, 0) NOT NULL,
	"usdc_amount" numeric(78, 0) NOT NULL,
	"leaf_index" integer NOT NULL,
	CONSTRAINT "hm_leaves_amounts" CHECK ("hm_leaves"."coin_amount" >= 0 and "hm_leaves"."usdc_amount" >= 0
        and ("hm_leaves"."coin_amount" > 0 or "hm_leaves"."usdc_amount" > 0))
);
--> statement-breakpoint
CREATE TABLE "hm_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"message_hash" text NOT NULL,
	"did" text NOT NULL,
	"wallet" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hm_operators" (
	"wallet" text PRIMARY KEY NOT NULL,
	"note" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hm_rule_drafts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hm_rule_drafts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"wallet" text NOT NULL,
	"body" text NOT NULL,
	"sources" jsonb,
	"reading" jsonb,
	"confirmed_at" timestamp with time zone,
	"bound_coin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hm_rule_drafts_bound_coin_unique" UNIQUE("bound_coin")
);
--> statement-breakpoint
CREATE TABLE "hm_rule_versions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hm_rule_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"coin" text NOT NULL,
	"version_no" integer NOT NULL,
	"body" text NOT NULL,
	"sources" jsonb NOT NULL,
	"reading" jsonb,
	"effective_from_epoch" integer NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hm_rules" (
	"coin" text PRIMARY KEY NOT NULL,
	"deployer" text NOT NULL,
	"current_version_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hm_rules_coin_lower" CHECK ("hm_rules"."coin" = lower("hm_rules"."coin"))
);
--> statement-breakpoint
CREATE TABLE "hm_scores" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hm_scores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"item_id" bigint NOT NULL,
	"round" integer NOT NULL,
	"median" integer NOT NULL,
	"reason" text NOT NULL,
	"cited" jsonb,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hm_scores_round" CHECK ("hm_scores"."round" in (0, 1)),
	CONSTRAINT "hm_scores_median" CHECK ("hm_scores"."median" >= 0 and "hm_scores"."median" <= 100),
	CONSTRAINT "hm_scores_status" CHECK ("hm_scores"."status" in ('scored','pulled','unscored_cap','rejected_output','excluded'))
);
--> statement-breakpoint
CREATE TABLE "hm_trees" (
	"coin" text NOT NULL,
	"epoch" integer NOT NULL,
	"root" text NOT NULL,
	"dump" jsonb NOT NULL,
	"vault_balance_at_build" numeric(78, 0),
	"coin_total" numeric(78, 0) NOT NULL,
	"usdc_total" numeric(78, 0) NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hm_trees_totals" CHECK ("hm_trees"."coin_total" >= 0 and "hm_trees"."usdc_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hm_usdc_splits" (
	"epoch" integer NOT NULL,
	"coin" text NOT NULL,
	"fee_share" numeric(78, 0) NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hm_usdc_splits_status" CHECK ("hm_usdc_splits"."status" in ('pending','deposited','released')),
	CONSTRAINT "hm_usdc_splits_amount" CHECK ("hm_usdc_splits"."amount" >= 0 and "hm_usdc_splits"."fee_share" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hm_users" (
	"did" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hm_users_wallet_unique" UNIQUE("wallet"),
	CONSTRAINT "hm_users_wallet_lower" CHECK ("hm_users"."wallet" = lower("hm_users"."wallet"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "hm_audit_sample" ON "hm_audit" USING btree ("item_id","round","sample_idx");--> statement-breakpoint
CREATE INDEX "hm_audit_item_idx" ON "hm_audit" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_bindings_pk" ON "hm_bindings" USING btree ("platform","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_bindings_platform_wallet" ON "hm_bindings" USING btree ("platform","wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_challenges_one_open" ON "hm_challenges" USING btree ("item_id","wallet") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "hm_challenges_epoch_idx" ON "hm_challenges" USING btree ("coin","epoch");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_epochs_pk" ON "hm_epochs" USING btree ("coin","epoch");--> statement-breakpoint
CREATE INDEX "hm_epochs_state_idx" ON "hm_epochs" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_items_external" ON "hm_items" USING btree ("coin","epoch","lane","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_items_origin" ON "hm_items" USING btree ("origin_item_id");--> statement-breakpoint
CREATE INDEX "hm_items_epoch_idx" ON "hm_items" USING btree ("coin","epoch");--> statement-breakpoint
CREATE INDEX "hm_items_author_idx" ON "hm_items" USING btree ("platform","platform_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_jobs_identity" ON "hm_jobs" USING btree ("type","coin","epoch","key");--> statement-breakpoint
CREATE INDEX "hm_jobs_due_idx" ON "hm_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_keeper_txs_kind" ON "hm_keeper_txs" USING btree ("kind","coin","epoch");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_keeper_txs_hash" ON "hm_keeper_txs" USING btree ("hash");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_lane_reads_pk" ON "hm_lane_reads" USING btree ("coin","epoch","lane");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_leaves_pk" ON "hm_leaves" USING btree ("coin","epoch","wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_leaves_index" ON "hm_leaves" USING btree ("coin","epoch","leaf_index");--> statement-breakpoint
CREATE INDEX "hm_rule_drafts_wallet_idx" ON "hm_rule_drafts" USING btree ("wallet","created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "hm_rule_versions_coin_no" ON "hm_rule_versions" USING btree ("coin","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_rule_versions_coin_epoch" ON "hm_rule_versions" USING btree ("coin","effective_from_epoch");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_scores_item_round" ON "hm_scores" USING btree ("item_id","round");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_trees_pk" ON "hm_trees" USING btree ("coin","epoch");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_trees_root" ON "hm_trees" USING btree ("root");--> statement-breakpoint
CREATE UNIQUE INDEX "hm_usdc_splits_pk" ON "hm_usdc_splits" USING btree ("epoch","coin");