CREATE OR REPLACE FUNCTION public.claim_offline_number(_restaurant_id uuid, _series text, _request_id uuid, _number bigint, _device text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  existing bigint;
  last_seq bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_restaurant_member(_restaurant_id) THEN
    RAISE EXCEPTION 'Restaurant membership required.' USING ERRCODE = '42501';
  END IF;
  IF _series NOT IN ('POS', 'KOT') OR _request_id IS NULL OR _number IS NULL OR _number < 1 THEN
    RAISE EXCEPTION 'Invalid numbering request.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.counter_print_routes r WHERE r.restaurant_id = _restaurant_id AND r.device_id = _device) THEN
    RAISE EXCEPTION 'Only the designated counter can number bills offline.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_restaurant_id::text || ':' || _series || ':offline', 0));

  SELECT sequence_number INTO existing FROM public.restaurant_number_allocations
   WHERE restaurant_id = _restaurant_id AND series = _series AND request_id = _request_id;
  IF existing IS NOT NULL THEN
    RETURN _series || '/' || lpad(existing::text, greatest(4, length(existing::text)), '0');
  END IF;

  SELECT last_sequence INTO last_seq FROM public.restaurant_number_sequences
   WHERE restaurant_id = _restaurant_id AND series = _series FOR UPDATE;
  IF coalesce(last_seq, 0) + 1 <> _number
     OR EXISTS (SELECT 1 FROM public.restaurant_number_allocations WHERE restaurant_id = _restaurant_id AND series = _series AND sequence_number = _number) THEN
    RETURN NULL; -- someone else took this number while the counter was offline
  END IF;

  INSERT INTO public.restaurant_number_sequences AS seq (restaurant_id, series, last_sequence)
  VALUES (_restaurant_id, _series, _number)
  ON CONFLICT (restaurant_id, series) DO UPDATE SET last_sequence = _number, updated_at = clock_timestamp();
  INSERT INTO public.restaurant_number_allocations (restaurant_id, series, request_id, sequence_number)
  VALUES (_restaurant_id, _series, _request_id, _number);
  RETURN _series || '/' || lpad(_number::text, greatest(4, length(_number::text)), '0');
END;
$$;
REVOKE ALL ON FUNCTION public.claim_offline_number(uuid, text, uuid, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_offline_number(uuid, text, uuid, bigint, text) TO authenticated;