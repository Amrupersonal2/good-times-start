-- Restaurant-wide bill and KOT allocators.
-- Allocation is server-authoritative and idempotent for a caller-supplied request UUID.

CREATE TABLE public.restaurant_number_sequences (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  series text NOT NULL CHECK (series IN ('POS', 'KOT')),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, series)
);

CREATE TABLE public.restaurant_number_allocations (
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
    RAISE EXCEPTION 'Restaurant membership required to allocate a number.'
      USING ERRCODE = '42501';
  END IF;

  IF _series IS NULL OR _series NOT IN ('POS', 'KOT') OR _request_id IS NULL THEN
    RAISE EXCEPTION 'Invalid numbering request.';
  END IF;

  -- Serialize retries of the same request independently from other requests.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(_restaurant_id::text || ':' || _series || ':' || _request_id::text, 0)
  );

  SELECT sequence_number INTO allocated
  FROM public.restaurant_number_allocations
  WHERE restaurant_id = _restaurant_id
    AND series = _series
    AND request_id = _request_id;

  IF allocated IS NOT NULL THEN
    RETURN _series || '/' || CASE WHEN allocated < 10000 THEN lpad(allocated::text, 4, '0') ELSE allocated::text END;
  END IF;

  IF _series = 'POS' THEN
    SELECT coalesce(max(((regexp_match(payload->>'billNo', '([0-9]+)
  ON CONFLICT (restaurant_id, series)
  DO UPDATE SET
    last_sequence = seq.last_sequence + 1,
    updated_at = clock_timestamp()
  RETURNING last_sequence INTO allocated;

  INSERT INTO public.restaurant_number_allocations
    (restaurant_id, series, request_id, sequence_number)
  VALUES (_restaurant_id, _series, _request_id, allocated);

  RETURN _series || '/' || CASE WHEN allocated < 10000 THEN lpad(allocated::text, 4, '0') ELSE allocated::text END;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_restaurant_number(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_restaurant_number(uuid, text, uuid) TO authenticated;
))[1])::bigint), 0)
      INTO current_max
    FROM public.restaurant_records
    WHERE restaurant_id = _restaurant_id AND kind = 'order' AND NOT deleted;
  ELSE
    SELECT greatest(
      coalesce(max(((regexp_match(payload->>'kotNo', '^KOT/([0-9]+)
  ON CONFLICT (restaurant_id, series)
  DO UPDATE SET
    last_sequence = seq.last_sequence + 1,
    updated_at = clock_timestamp()
  RETURNING last_sequence INTO allocated;

  INSERT INTO public.restaurant_number_allocations
    (restaurant_id, series, request_id, sequence_number)
  VALUES (_restaurant_id, _series, _request_id, allocated);

  RETURN _series || '/' || CASE WHEN allocated < 10000 THEN lpad(allocated::text, 4, '0') ELSE allocated::text END;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_restaurant_number(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_restaurant_number(uuid, text, uuid) TO authenticated;
))[1])::bigint), 0),
      count(DISTINCT coalesce(payload->>'submissionId',
        'legacy:' || coalesce(payload->>'orderUid', '') || ':' || coalesce(payload->>'createdAt', '')))
    ) INTO current_max
    FROM public.restaurant_records
    WHERE restaurant_id = _restaurant_id AND kind = 'kot' AND NOT deleted;
  END IF;

  INSERT INTO public.restaurant_number_sequences AS seq (restaurant_id, series, last_sequence)
  VALUES (_restaurant_id, _series, current_max + 1)
  ON CONFLICT (restaurant_id, series)
  DO UPDATE SET
    last_sequence = seq.last_sequence + 1,
    updated_at = clock_timestamp()
  RETURNING last_sequence INTO allocated;

  INSERT INTO public.restaurant_number_allocations
    (restaurant_id, series, request_id, sequence_number)
  VALUES (_restaurant_id, _series, _request_id, allocated);

  RETURN _series || '/' || CASE WHEN allocated < 10000 THEN lpad(allocated::text, 4, '0') ELSE allocated::text END;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_restaurant_number(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_restaurant_number(uuid, text, uuid) TO authenticated;


-- Reject stale-device overwrites and tombstone resurrection. New records must
-- use the restaurant-wide formats; the allocator RPC above issues their values.
CREATE OR REPLACE FUNCTION public.guard_restaurant_numbered_records()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  prior public.restaurant_records;
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

  IF NOT NEW.deleted AND NEW.kind = 'order' AND coalesce(NEW.payload->>'billNo', '') !~ '^POS/[0-9]{4,}$' THEN
    RAISE EXCEPTION 'Update the POS app before creating new bills.' USING ERRCODE = '42501';
  END IF;
  IF NOT NEW.deleted AND NEW.kind = 'kot' AND coalesce(NEW.payload->>'kotNo', '') !~ '^KOT/[0-9]{4,}$' THEN
    RAISE EXCEPTION 'Update the POS app before sending new kitchen tickets.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER restaurant_records_numbering_guard
  BEFORE INSERT OR UPDATE ON public.restaurant_records
  FOR EACH ROW EXECUTE FUNCTION public.guard_restaurant_numbered_records();
