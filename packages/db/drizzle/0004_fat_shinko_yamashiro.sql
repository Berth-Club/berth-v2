CREATE TABLE "hm_wallet_claims" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hm_wallet_claims_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"platform" text NOT NULL,
	"subject" text NOT NULL,
	"wallet" text,
	"item_id" bigint,
	"coin" text,
	"epoch" integer,
	"status" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hm_wallet_claims_status" CHECK ("hm_wallet_claims"."status" in ('bound','already_bound_same','ignored_locked',
        'rejected_checksum','rejected_several','rejected_unpayable','wallet_taken'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "hm_wallet_claims_item_wallet" ON "hm_wallet_claims" USING btree ("item_id","wallet");--> statement-breakpoint
CREATE INDEX "hm_wallet_claims_subject" ON "hm_wallet_claims" USING btree ("platform","subject");