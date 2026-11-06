-- Restaurant-wide bill and KOT allocators.
-- Each logical bill/KOT submission receives one durable, idempotent server receipt.

CREATE TABLE IF NOT EXISTS public.restaurant_number_sequences (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  series text NOT NULL CHECK (series IN ('POS', 'KOT')),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, series)
);

CREATE TABLE IF NOT EXISTS public.restaurant_number_allocations (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  series text NOT NULL CHECK (series IN ('POS', 'KOT')),
  request_id uuid NOT NULL,
  sequence_number bigint NOT NULL CHECK (sequence_number > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, series, request_id),
  UNIQUE (restaurant_id, series, sequence_number)
);

ALTER TABLE public.restaurant_number_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_number_allocations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.restaurant_number_sequences TO authenticated;
GRANT ALL ON public.restaurant_number_sequences TO service_role;
GRANT ALL ON public.restaurant_number_allocations TO service_role;

DROP POLICY IF EXISTS restaurant_members_read_number_sequences ON public.restaurant_number_sequences;
CREATE POLICY restaurant_members_read_number_sequences
  ON public.restaurant_number_sequences FOR SELECT TO authenticated
  USING (public.is_restaurant_member(restaurant_id));

CREATE OR REPLACE FUNCTION public.allocate_restaurant_number(
  _restaurant_id uuid,
  _series text,
  _request_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  allocated bigint;
  current_max bigint := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_restaurant_member(_restaurant_id) THEN
    RAISE EXCEPTION 'Restaurant membership required to allocate a number.' USING ERRCODE = '42501';
  END IF;
  IF _series IS NULL OR _series NOT IN ('POS', 'KOT') OR _request_id IS NULL THEN
    RAISE EXCEPTION 'Invalid numbering request.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(_restaurant_id::text || ':' || _series || ':' || _request_id::text, 0)
  );

  SELECT sequence_number INTO allocated
  FROM public.restaurant_number_allocations
  WHERE restaurant_id = _restaurant_id AND series = _series AND request_id = _request_id;
  IF allocated IS NOT NULL THEN
    RETURN _series || '/' || lpad(allocated::text, greatest(4, length(allocated::text)), '0');
  END IF;

  IF _series = 'POS' THEN
    SELECT coalesce(max((regexp_match(payload->>'billNo', '([0-9]+)$'))[1]::bigint), 0)
      INTO current_max
    FROM public.restaurant_records
    WHERE restaurant_id = _restaurant_id AND kind = 'order' AND NOT deleted
      AND coalesce(payload->>'billNo', '') ~ '[0-9]+$'
      AND coalesce(payload->>'tableLabel', '') <> 'QAF1'
      AND coalesce(payload->>'tableId', '') <> 'QAF1'
      AND lower(coalesce(payload->>'tableSection', '')) <> 'floor verification';
  ELSE
    SELECT greatest(
      coalesce(max((regexp_match(payload->>'kotNo', '([0-9]+)$'))[1]::bigint), 0),
      count(DISTINCT coalesce(payload->>'submissionId',
        'legacy:' || coalesce(payload->>'orderUid', '') || ':' || coalesce(payload->>'createdAt', '')))
    )
      INTO current_max
    FROM public.restaurant_records
    WHERE restaurant_id = _restaurant_id AND kind = 'kot' AND NOT deleted
      AND coalesce(payload->>'tableLabel', '') <> 'QAF1'
      AND coalesce(payload->>'tableId', '') <> 'QAF1'
      AND lower(coalesce(payload->>'tableSection', '')) <> 'floor verification';
  END IF;

  INSERT INTO public.restaurant_number_sequences AS seq
    (restaurant_id, series, last_sequence)
  VALUES (_restaurant_id, _series, current_max + 1)
  ON CONFLICT (restaurant_id, series)
  DO UPDATE SET
    last_sequence = greatest(seq.last_sequence, current_max) + 1,
    updated_at = clock_timestamp()
  RETURNING last_sequence INTO allocated;

  INSERT INTO public.restaurant_number_allocations
    (restaurant_id, series, request_id, sequence_number)
  VALUES (_restaurant_id, _series, _request_id, allocated);

  RETURN _series || '/' || lpad(allocated::text, greatest(4, length(allocated::text)), '0');
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_restaurant_number(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_restaurant_number(uuid, text, uuid) TO authenticated;

-- Reject stale-device number changes, tombstone resurrection, and numbers
-- that were not issued by the allocator for this exact request UUID.
CREATE OR REPLACE FUNCTION public.guard_restaurant_numbered_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  prior public.restaurant_records;
  number_text text;
  request_text text;
  number_series text;
  number_value bigint;
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
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.deleted THEN RETURN NEW; END IF;

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
$$;

DROP TRIGGER IF EXISTS restaurant_records_numbering_guard ON public.restaurant_records;
CREATE TRIGGER restaurant_records_numbering_guard
  BEFORE INSERT OR UPDATE ON public.restaurant_records
  FOR EACH ROW EXECUTE FUNCTION public.guard_restaurant_numbered_records();
