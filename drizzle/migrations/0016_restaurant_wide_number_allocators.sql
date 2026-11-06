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
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_restaurant_member(_restaurant_id) THEN
    RAISE EXCEPTION 'Restaurant membership required to allocate a number.'
      USING ERRCODE = '42501';
  END IF;

  IF _series NOT IN ('POS', 'KOT') OR _request_id IS NULL THEN
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
    RETURN _series || '/' || lpad(allocated::text, 4, '0');
  END IF;

  INSERT INTO public.restaurant_number_sequences (restaurant_id, series, last_sequence)
  VALUES (_restaurant_id, _series, 1)
  ON CONFLICT (restaurant_id, series)
  DO UPDATE SET
    last_sequence = public.restaurant_number_sequences.last_sequence + 1,
    updated_at = clock_timestamp()
  RETURNING last_sequence INTO allocated;

  INSERT INTO public.restaurant_number_allocations
    (restaurant_id, series, request_id, sequence_number)
  VALUES (_restaurant_id, _series, _request_id, allocated);

  RETURN _series || '/' || lpad(allocated::text, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_restaurant_number(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_restaurant_number(uuid, text, uuid) TO authenticated;
