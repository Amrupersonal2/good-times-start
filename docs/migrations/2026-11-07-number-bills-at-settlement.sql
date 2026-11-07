-- Bills get their official POS number at settlement or first print, not when they open.
-- Running (held) and never-numbered cancelled bills may have an empty billNo; a bill that
-- receives a number must use one the allocator issued; a settled bill must have a number.
-- Existing protections are unchanged: numbers can't be overwritten, tombstones can't be revived.
CREATE OR REPLACE FUNCTION public.guard_restaurant_numbered_records()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  prior public.restaurant_records;
  number_text text;
  request_text text;
  number_series text;
  number_value bigint;
  check_allocation boolean := false;
BEGIN
  IF NEW.kind NOT IN ('order', 'kot') THEN RETURN NEW; END IF;

  SELECT * INTO prior
  FROM public.restaurant_records
  WHERE restaurant_id = NEW.restaurant_id AND kind = NEW.kind AND record_id = NEW.record_id;

  IF FOUND THEN
    IF prior.deleted AND NOT NEW.deleted THEN
      RAISE EXCEPTION 'A centrally deleted record cannot be restored from a stale device.' USING ERRCODE = '42501';
    END IF;
    IF NOT prior.deleted AND NOT NEW.deleted THEN
      IF NEW.kind = 'order' AND prior.payload->>'billNo' LIKE 'POS/%'
         AND NEW.payload->>'billNo' IS DISTINCT FROM prior.payload->>'billNo' THEN
        RAISE EXCEPTION 'A centrally assigned bill number cannot be overwritten.' USING ERRCODE = '42501';
      END IF;
      IF NEW.kind = 'kot' AND prior.payload->>'kotNo' LIKE 'KOT/%'
         AND NEW.payload->>'kotNo' IS DISTINCT FROM prior.payload->>'kotNo' THEN
        RAISE EXCEPTION 'A centrally assigned KOT number cannot be overwritten.' USING ERRCODE = '42501';
      END IF;
      IF NEW.kind = 'order' THEN
        -- A running bill receiving its number at settlement or first print.
        IF coalesce(prior.payload->>'billNo', '') = '' AND coalesce(NEW.payload->>'billNo', '') <> '' THEN
          check_allocation := true;
        END IF;
        IF NEW.payload->>'status' = 'settled' AND coalesce(NEW.payload->>'billNo', '') = '' THEN
          RAISE EXCEPTION 'Update the POS app before creating numbered records.' USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;
    IF NOT check_allocation THEN RETURN NEW; END IF;
  ELSE
    IF NEW.deleted THEN RETURN NEW; END IF;
    -- New running bill, or a cancelled one that never had a number: no number yet.
    IF NEW.kind = 'order' AND coalesce(NEW.payload->>'billNo', '') = ''
       AND coalesce(NEW.payload->>'status', '') IN ('held', 'void') THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.kind = 'order' THEN
    number_text := NEW.payload->>'billNo';
    request_text := NEW.payload->>'numberRequestId';
    number_series := 'POS';
  ELSE
    number_text := NEW.payload->>'kotNo';
    request_text := coalesce(NEW.payload->>'numberRequestId', NEW.payload->>'submissionId');
    number_series := 'KOT';
  END IF;

  IF coalesce(number_text, '') !~ ('^' || number_series || '/[0-9]{4,}$')
     OR coalesce(request_text, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Update the POS app before creating numbered records.' USING ERRCODE = '42501';
  END IF;

  number_value := substring(number_text from '/([0-9]+)$')::bigint;
  IF NOT EXISTS (
    SELECT 1 FROM public.restaurant_number_allocations a
    WHERE a.restaurant_id = NEW.restaurant_id
      AND a.series = number_series
      AND a.request_id = request_text::uuid
      AND a.sequence_number = number_value
  ) THEN
    RAISE EXCEPTION 'The % number was not allocated for this submission.', number_series USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
