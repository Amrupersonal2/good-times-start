-- Enforce rotating approval for staff voiding settled bills.
-- The approval is consumed atomically by the bill guard, scoped to restaurant,
-- authenticated staff user, and immutable bill UID. Run after migration 0014.

CREATE OR REPLACE FUNCTION public.protect_closed_bills()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  was text := OLD.payload ->> 'status';
  now_status text := NEW.payload ->> 'status';
  approval_id uuid;
  reason text := btrim(coalesce(NEW.payload ->> 'voidReason', ''));
BEGIN
  IF NEW.kind <> 'order' OR was NOT IN ('settled', 'void') THEN
    RETURN NEW;
  END IF;

  -- Requests without a signed-in user (service role / maintenance) pass.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Preserve the existing owner/manager override.
  IF public.is_restaurant_admin_of(NEW.restaurant_id) THEN
    IF now_status = 'void' AND reason = '' THEN
      RAISE EXCEPTION 'A void reason is required' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  -- Staff may only make the single allowed transition: settled -> void.
  -- No deletion, amount/item/payment edits, or bill-number changes.
  IF was = 'settled'
     AND now_status = 'void'
     AND NOT NEW.deleted
     AND (NEW.payload -> 'total') IS NOT DISTINCT FROM (OLD.payload -> 'total')
     AND (NEW.payload -> 'lines') IS NOT DISTINCT FROM (OLD.payload -> 'lines')
     AND (NEW.payload -> 'payments') IS NOT DISTINCT FROM (OLD.payload -> 'payments')
     AND (NEW.payload -> 'discountAmt') IS NOT DISTINCT FROM (OLD.payload -> 'discountAmt')
     AND (NEW.payload ->> 'billNo') IS NOT DISTINCT FROM (OLD.payload ->> 'billNo')
     AND reason <> ''
     AND length(reason) <= 500
     AND coalesce(NEW.payload ->> 'uid', NEW.uid::text) IS NOT NULL
  THEN
    -- Lock the exact approval row, then consume it in this transaction.
    -- The trigger update and approval consumption commit/rollback together.
    SELECT a.id
      INTO approval_id
      FROM public.restaurant_void_approvals AS a
     WHERE a.restaurant_id = NEW.restaurant_id
       AND a.user_id = auth.uid()
       AND a.bill_uid = coalesce(NEW.payload ->> 'uid', NEW.uid::text)
       AND a.expires_at > clock_timestamp()
       AND a.consumed_at IS NULL
     ORDER BY a.created_at DESC
     LIMIT 1
     FOR UPDATE;

    IF approval_id IS NULL THEN
      RAISE EXCEPTION 'Valid admin approval required to void this settled bill'
        USING ERRCODE = '42501';
    END IF;

    UPDATE public.restaurant_void_approvals
       SET consumed_at = clock_timestamp()
     WHERE id = approval_id
       AND consumed_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Admin approval was already consumed'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  -- A void bill is immutable for staff. Feedback-only updates remain allowed.
  IF NEW.deleted
     OR now_status IS DISTINCT FROM was
     OR (NEW.payload -> 'total') IS DISTINCT FROM (OLD.payload -> 'total')
     OR (NEW.payload -> 'lines') IS DISTINCT FROM (OLD.payload -> 'lines')
     OR (NEW.payload -> 'payments') IS DISTINCT FROM (OLD.payload -> 'payments')
     OR (NEW.payload -> 'discountAmt') IS DISTINCT FROM (OLD.payload -> 'discountAmt')
     OR (NEW.payload ->> 'billNo') IS DISTINCT FROM (OLD.payload ->> 'billNo') THEN
    RAISE EXCEPTION 'Only the owner or a manager can change a % bill', CASE WHEN was = 'void' THEN 'cancelled' ELSE 'settled' END
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS restaurant_records_protect_bills ON public.restaurant_records;
CREATE TRIGGER restaurant_records_protect_bills
BEFORE UPDATE ON public.restaurant_records
FOR EACH ROW EXECUTE FUNCTION public.protect_closed_bills();

REVOKE EXECUTE ON FUNCTION public.protect_closed_bills() FROM PUBLIC, anon, authenticated;
