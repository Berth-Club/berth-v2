-- Freeze the financial record once a payout is on chain.
--
-- A score, a leaf and a tree are the public justification for money that has
-- already moved. Once `hm_epochs.posted_at` is set, nothing about that epoch may
-- change, or a reader could be shown a different list than the one the keeper
-- signed. Postgres has no declarative "frozen", so this is a trigger.
--
-- Two carve-outs, both deliberate:
--   * `hm_items.content` and `hm_challenges.body` hold attacker-authored text.
--     X's terms give a 24-hour takedown duty, and an author may ask for their
--     unbound line to be removed. Those columns stay erasable; everything
--     around them, including the content hash, does not.
--   * `hm_challenges.status` and its verdict may be written after settlement,
--     because a rescore in flight at the deadline still has to record its
--     answer. Without this the handler would fail, retry, and park a fully paid
--     epoch in needs_operator.

CREATE OR REPLACE FUNCTION hm_epoch_is_posted(p_coin text, p_epoch integer)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM hm_epochs
    WHERE coin = p_coin AND epoch = p_epoch AND posted_at IS NOT NULL
  );
$$;
--> statement-breakpoint

-- Rows that carry their own (coin, epoch): trees, leaves, usdc splits.
CREATE OR REPLACE FUNCTION hm_freeze_by_epoch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_coin text;
  v_epoch integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_coin := OLD.coin; v_epoch := OLD.epoch;
  ELSE
    v_coin := NEW.coin; v_epoch := NEW.epoch;
  END IF;

  IF hm_epoch_is_posted(v_coin, v_epoch) THEN
    RAISE EXCEPTION
      'hm_freeze: % on % is frozen, epoch % of % is already paid out',
      TG_OP, TG_TABLE_NAME, v_epoch, v_coin
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Items reach their epoch through their own columns, but keep one erasable
-- column so a takedown is still possible on a frozen epoch.
CREATE OR REPLACE FUNCTION hm_freeze_items()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
$$;
--> statement-breakpoint

-- Scores reach their epoch through the item they belong to.
CREATE OR REPLACE FUNCTION hm_freeze_scores()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_coin text;
  v_epoch integer;
  v_item bigint;
BEGIN
  v_item := CASE WHEN TG_OP = 'DELETE' THEN OLD.item_id ELSE NEW.item_id END;
  SELECT coin, epoch INTO v_coin, v_epoch FROM hm_items WHERE id = v_item;

  IF v_coin IS NOT NULL AND hm_epoch_is_posted(v_coin, v_epoch) THEN
    RAISE EXCEPTION
      'hm_freeze: % on hm_scores is frozen, epoch % of % is already paid out',
      TG_OP, v_epoch, v_coin
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Challenges freeze except for the verdict, which a late rescore still writes.
CREATE OR REPLACE FUNCTION hm_freeze_challenges()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT hm_epoch_is_posted(
       CASE WHEN TG_OP = 'DELETE' THEN OLD.coin ELSE NEW.coin END,
       CASE WHEN TG_OP = 'DELETE' THEN OLD.epoch ELSE NEW.epoch END) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'hm_freeze: cannot delete a challenge from a paid epoch'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF (NEW.id, NEW.item_id, NEW.coin, NEW.epoch, NEW.wallet, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.item_id, OLD.coin, OLD.epoch, OLD.wallet, OLD.created_at) THEN
    RAISE EXCEPTION
      'hm_freeze: challenge % is frozen, only its verdict and body may change', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- A rule version is immutable the moment the creator confirms it, because an
-- epoch stores a reference to it rather than a copy of its text.
CREATE OR REPLACE FUNCTION hm_freeze_rule_versions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION
      'hm_freeze: rule version % is confirmed and cannot change', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER hm_freeze_trees BEFORE UPDATE OR DELETE ON hm_trees
  FOR EACH ROW EXECUTE FUNCTION hm_freeze_by_epoch();
--> statement-breakpoint
CREATE TRIGGER hm_freeze_leaves BEFORE UPDATE OR DELETE ON hm_leaves
  FOR EACH ROW EXECUTE FUNCTION hm_freeze_by_epoch();
--> statement-breakpoint
CREATE TRIGGER hm_freeze_usdc_splits BEFORE UPDATE OR DELETE ON hm_usdc_splits
  FOR EACH ROW EXECUTE FUNCTION hm_freeze_by_epoch();
--> statement-breakpoint
CREATE TRIGGER hm_freeze_items_trg BEFORE UPDATE OR DELETE ON hm_items
  FOR EACH ROW EXECUTE FUNCTION hm_freeze_items();
--> statement-breakpoint
CREATE TRIGGER hm_freeze_scores_trg BEFORE UPDATE OR DELETE ON hm_scores
  FOR EACH ROW EXECUTE FUNCTION hm_freeze_scores();
--> statement-breakpoint
CREATE TRIGGER hm_freeze_challenges_trg BEFORE UPDATE OR DELETE ON hm_challenges
  FOR EACH ROW EXECUTE FUNCTION hm_freeze_challenges();
--> statement-breakpoint
CREATE TRIGGER hm_freeze_rule_versions_trg BEFORE UPDATE OR DELETE ON hm_rule_versions
  FOR EACH ROW EXECUTE FUNCTION hm_freeze_rule_versions();
