CREATE TABLE "hm_fomo_users" (
	"subject" text PRIMARY KEY NOT NULL,
	"handle" text,
	"evm_address" text,
	"sol_address" text,
	"resolved_at" timestamp with time zone,
	"note" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "hm_fomo_users_unresolved" ON "hm_fomo_users" USING btree ("resolved_at");