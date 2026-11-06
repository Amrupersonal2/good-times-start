-- 0022: settlement ledger integrity and immutable KOT identity.
-- Additive: live POS, staff apps and guest order creation remain enabled.

CREATE OR REPLACE FUNCTION public.validate_settled_order_payload()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _payment jsonb; _mode text; _amount numeric; _total numeric;
  _paid numeric := 0; _count integer := 0;
BEGIN
  IF NEW.kind <> 'order' OR NEW.deleted OR NEW.payload->>'status' IS DISTINCT FROM 'settled' THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.payload->'payments') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'A settled bill must contain a payment array' USING ERRCODE = '23514';
  END IF;
  IF coalesce(NEW.payload->>'total', '') !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    RAISE EXCEPTION 'A settled bill must contain a valid total' USING ERRCODE = '23514';
  END IF;
  _total := round((NEW.payload->>'total')::numeric, 2);
  IF _total < 0 THEN RAISE EXCEPTION 'A settled bill cannot have a negative total' USING ERRCODE = '23514'; END IF;
  FOR _payment IN SELECT value FROM jsonb_array_elements(NEW.payload->'payments') LOOP
    _mode := _payment->>'mode';
    IF _mode NOT IN ('cash', 'upi', 'card', 'wallet', 'credit', 'points') THEN
      RAISE EXCEPTION 'Unsupported payment mode on settled bill' USING ERRCODE = '23514';
    END IF;
    IF coalesce(_payment->>'amount', '') !~ '^[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'Every payment must have a valid positive amount' USING ERRCODE = '23514';
    END IF;
    _amount := round((_payment->>'amount')::numeric, 2);
    IF _amount <= 0 THEN RAISE EXCEPTION 'Every payment must have a positive amount' USING ERRCODE = '23514'; END IF;
    _paid := _paid + _amount; _count := _count + 1;
  END LOOP;
  IF (_total = 0 AND _count <> 0) OR (_total > 0 AND _count = 0) OR abs(round(_paid, 2) - _total) > 0.01 THEN
    RAISE EXCEPTION 'Recorded payments must equal the settled bill total' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS restaurant_records_validate_settlement ON public.restaurant_records;
CREATE TRIGGER restaurant_records_validate_settlement
  BEFORE INSERT OR UPDATE ON public.restaurant_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_settled_order_payload();

-- Payment rows remain readable/insertable for compatible clients, but every
-- insert must match an exact tender on an already-settled bill.
CREATE OR REPLACE FUNCTION public.validate_bill_payment_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _order jsonb; _payments jsonb; _index integer; _expected jsonb; _amount numeric;
BEGIN
  IF auth.uid() IS NULL OR NEW.recorded_by IS DISTINCT FROM auth.uid()
     OR NOT public.is_restaurant_member(NEW.restaurant_id) THEN
    RAISE EXCEPTION 'Not authorised to record this bill payment' USING ERRCODE = '42501';
  END IF;
  SELECT payload INTO _order FROM public.restaurant_records
   WHERE restaurant_id = NEW.restaurant_id AND kind = 'order' AND record_id = NEW.order_uid AND NOT deleted
   FOR KEY SHARE;
  IF _order IS NULL OR _order->>'status' IS DISTINCT FROM 'settled' THEN
    RAISE EXCEPTION 'Payment must belong to an already-settled bill' USING ERRCODE = '23514';
  END IF;
  IF split_part(NEW.payment_key, ':', 1) !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Invalid payment idempotency key' USING ERRCODE = '23514';
  END IF;
  _index := split_part(NEW.payment_key, ':', 1)::integer;
  _payments := _order->'payments';
  IF jsonb_typeof(_payments) IS DISTINCT FROM 'array' OR _index < 0 OR _index >= jsonb_array_length(_payments) THEN
    RAISE EXCEPTION 'Payment does not exist on the settled bill' USING ERRCODE = '23514';
  END IF;
  _expected := _payments->_index;
  IF NEW.mode IS DISTINCT FROM _expected->>'mode'
     OR NEW.payment_key IS DISTINCT FROM (_index::text || ':' || coalesce(_expected->>'mode', ''))
     OR coalesce(_expected->>'amount', '') !~ '^[0-9]+(\.[0-9]+)?$' THEN
    RAISE EXCEPTION 'Payment details do not match the settled bill' USING ERRCODE = '23514';
  END IF;
  _amount := round((_expected->>'amount')::numeric, 2);
  IF NEW.amount IS DISTINCT FROM _amount THEN
    RAISE EXCEPTION 'Payment amount does not match the settled bill' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.validate_bill_payment_row() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bill_payments_validate_row ON public.bill_payments;
CREATE TRIGGER bill_payments_validate_row BEFORE INSERT ON public.bill_payments
  FOR EACH ROW EXECUTE FUNCTION public.validate_bill_payment_row();

ALTER TABLE public.bill_payments
  DROP CONSTRAINT IF EXISTS bill_payments_amount_positive,
  ADD CONSTRAINT bill_payments_amount_positive CHECK (amount > 0),
  DROP CONSTRAINT IF EXISTS bill_payments_mode_valid,
  ADD CONSTRAINT bill_payments_mode_valid CHECK (mode IN ('cash', 'upi', 'card', 'wallet', 'credit', 'points'));

-- KOT status changes remain allowed; deduplication identity cannot be changed.
CREATE OR REPLACE FUNCTION public.protect_kot_submission_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.kind = 'kot' AND NEW.kind = 'kot' AND (
    OLD.payload->>'submissionId' IS DISTINCT FROM NEW.payload->>'submissionId'
    OR OLD.payload->>'station' IS DISTINCT FROM NEW.payload->>'station'
    OR OLD.payload->>'kind' IS DISTINCT FROM NEW.payload->>'kind'
    OR OLD.payload->>'orderUid' IS DISTINCT FROM NEW.payload->>'orderUid'
  ) THEN
    RAISE EXCEPTION 'KOT submission identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS restaurant_records_kot_identity ON public.restaurant_records;
CREATE TRIGGER restaurant_records_kot_identity BEFORE UPDATE ON public.restaurant_records
  FOR EACH ROW EXECUTE FUNCTION public.protect_kot_submission_identity();

REVOKE ALL ON FUNCTION public.validate_settled_order_payload() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_kot_submission_identity() FROM PUBLIC, anon, authenticated;
