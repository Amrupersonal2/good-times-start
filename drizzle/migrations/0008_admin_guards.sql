-- XTSY POS: admin controls enforced in the database, so a changed screen or a
-- tampered device can't get around them. Run after 0007. Safe to re-run.
--
-- 1. Menu, stock materials, suppliers and restaurant details: owner/manager only.
--    (Tables, bills, KOTs, stock movements, guests and day closes stay open to
--    staff: a shift needs them.)
-- 2. A settled or cancelled bill can't be changed or deleted by staff: its
--    status, amounts, items and payments are fixed unless an owner or manager
--    does it (voids need a reason and an admin anyway). Staff can still add the
--    guest's feedback to a settled bill.

CREATE OR REPLACE FUNCTION public.is_restaurant_admin_of(_rid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT has_restaurant_role(_rid, auth.uid(), ARRAY['owner','manager']::restaurant_role[]) $$;
REVOKE EXECUTE ON FUNCTION public.is_restaurant_admin_of(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_restaurant_admin_of(uuid) TO authenticated;

DROP POLICY IF EXISTS "members write records" ON public.restaurant_records;
DROP POLICY IF EXISTS "members update records" ON public.restaurant_records;
CREATE POLICY "members write records" ON public.restaurant_records FOR INSERT TO authenticated
  WITH CHECK (public.is_member(restaurant_id, auth.uid())
    AND (kind NOT IN ('settings','menu','material','supplier') OR public.is_restaurant_admin_of(restaurant_id)));
CREATE POLICY "members update records" ON public.restaurant_records FOR UPDATE TO authenticated
  USING (public.is_member(restaurant_id, auth.uid()))
  WITH CHECK (public.is_member(restaurant_id, auth.uid())
    AND (kind NOT IN ('settings','menu','material','supplier') OR public.is_restaurant_admin_of(restaurant_id)));

CREATE OR REPLACE FUNCTION public.protect_closed_bills() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE was text := OLD.payload ->> 'status';
BEGIN
  IF NEW.kind <> 'order' OR was NOT IN ('settled', 'void') THEN RETURN NEW; END IF;
  -- Requests without a signed-in user (service role, maintenance) pass.
  IF auth.uid() IS NULL OR public.is_restaurant_admin_of(NEW.restaurant_id) THEN RETURN NEW; END IF;
  IF NEW.deleted
     OR (NEW.payload ->> 'status') IS DISTINCT FROM was
     OR (NEW.payload -> 'total') IS DISTINCT FROM (OLD.payload -> 'total')
     OR (NEW.payload -> 'lines') IS DISTINCT FROM (OLD.payload -> 'lines')
     OR (NEW.payload -> 'payments') IS DISTINCT FROM (OLD.payload -> 'payments')
     OR (NEW.payload -> 'discountAmt') IS DISTINCT FROM (OLD.payload -> 'discountAmt')
     OR (NEW.payload ->> 'billNo') IS DISTINCT FROM (OLD.payload ->> 'billNo') THEN
    RAISE EXCEPTION 'Only the owner or a manager can change a % bill', CASE WHEN was = 'void' THEN 'cancelled' ELSE 'settled' END
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS restaurant_records_protect_bills ON public.restaurant_records;
CREATE TRIGGER restaurant_records_protect_bills BEFORE UPDATE ON public.restaurant_records
  FOR EACH ROW EXECUTE FUNCTION public.protect_closed_bills();
