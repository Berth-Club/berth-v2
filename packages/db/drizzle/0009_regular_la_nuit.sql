ALTER TABLE "hm_fomo_callouts" ADD COLUMN "num_likes" integer;--> statement-breakpoint
ALTER TABLE "hm_fomo_callouts" ADD COLUMN "position_usd" numeric(38, 6);--> statement-breakpoint
ALTER TABLE "hm_fomo_callouts" ADD COLUMN "sold_at" timestamp with time zone;