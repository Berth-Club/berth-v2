-- "lane" becomes "venue" everywhere.
--
-- Written by hand rather than generated. drizzle-kit sees a table that vanished
-- and a table that appeared, so it emits DROP then CREATE, which would throw
-- away every read status ever recorded. ALTER keeps the rows.
--
-- Every statement is conditional. A rename is not naturally idempotent, and a
-- migration that only works on a database in exactly one state is a migration
-- that strands anyone who applied part of it by hand.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hm_lane_reads') THEN
    ALTER TABLE "hm_lane_reads" RENAME TO "hm_venue_reads";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'hm_venue_reads' AND column_name = 'lane') THEN
    ALTER TABLE "hm_venue_reads" RENAME COLUMN "lane" TO "venue";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'hm_items' AND column_name = 'lane') THEN
    ALTER TABLE "hm_items" RENAME COLUMN "lane" TO "venue";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'hm_lane_reads_pk') THEN
    ALTER INDEX "hm_lane_reads_pk" RENAME TO "hm_venue_reads_pk";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hm_lane_reads_status') THEN
    ALTER TABLE "hm_venue_reads" RENAME CONSTRAINT "hm_lane_reads_status" TO "hm_venue_reads_status";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hm_lane_reads_skip_has_reason') THEN
    ALTER TABLE "hm_venue_reads" RENAME CONSTRAINT "hm_lane_reads_skip_has_reason" TO "hm_venue_reads_skip_has_reason";
  END IF;
END $$;--> statement-breakpoint

-- The job type moves with it, or every queued read is parked as unrecognised.
UPDATE "hm_jobs" SET "type" = 'venue_read' WHERE "type" = 'lane_read';

--> statement-breakpoint
-- Recreate the freeze trigger's function body.
--
-- Renaming a column does NOT rewrite the PL/pgSQL that reads it, so this
-- function kept comparing `NEW.lane` and every content takedown began failing
-- with `record "new" has no field "lane"`. Nothing warns about this: the rename
-- succeeds, the function stays valid until it runs, and the first symptom is a
-- legal request that cannot be honoured.
CREATE OR REPLACE FUNCTION public.hm_freeze_items()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_coin text;
  v_epoch integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_coin := OLD.coin; v_epoch := OLD.epoch;
  ELSE
    v_coin := NEW.coin; v_epoch := NEW.epoch;
  END IF;

  IF NOT hm_epoch_is_posted(v_coin, v_epoch) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'hm_freeze: cannot delete an item from a paid epoch'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Everything except the erasable pair must match the stored row.
  IF (NEW.id, NEW.coin, NEW.epoch, NEW.venue, NEW.platform, NEW.platform_user_id,
      NEW.platform_handle, NEW.external_id, NEW.link, NEW.content_hash,
      NEW.stripped_bytes, NEW.status, NEW.origin_item_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.coin, OLD.epoch, OLD.venue, OLD.platform, OLD.platform_user_id,
      OLD.platform_handle, OLD.external_id, OLD.link, OLD.content_hash,
      OLD.stripped_bytes, OLD.status, OLD.origin_item_id, OLD.created_at) THEN
    RAISE EXCEPTION
      'hm_freeze: item % is frozen, only content may be erased after payout', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$function$;
