-- 0020: server-authoritative record versions, idempotent KOT submissions and
-- atomic bill settlement.
--
-- Additive and backwards compatible:
--   * restaurant_records gains a server-owned `version` (clients can never set it).
--   * Legacy clients that still upsert directly keep working; their writes bump
--     the version too, so versioned clients detect them as concurrent edits.
--   * New clients call push_restaurant_records(), which runs as the caller
--     (SECURITY INVOKER) so every existing RLS policy and guard trigger
--     (launch cut-off, closed-bill protection, numbering guards) still applies.
-- Rollback: drop the two functions and triggers added here; the extra column
-- and tables are inert for old clients.

-- 1. Monotonic, server-owned versions -----------------------------------------
ALTER TABLE public.restaurant_records ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.bump_record_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := 1;
  ELSE
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS restaurant_records_version ON public.restaurant_records;
CREATE TRIGGER restaurant_records_version
  BEFORE INSERT OR UPDATE ON public.restaurant_records
  FOR EACH ROW EXECUTE FUNCTION public.bump_record_version();

-- 2. Exactly-once logical KOT tickets -------------------------------------------
-- One row per (submission, station, ticket kind). A retried or duplicated
-- submission maps onto the ticket that was stored first.
CREATE TABLE IF NOT EXISTS public.kot_submission_tickets (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  submission_id text NOT NULL,
  station text NOT NULL,
  ticket_kind text NOT NULL DEFAULT 'new',
  record_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, submission_id, station, ticket_kind)
);
GRANT ALL ON public.kot_submission_tickets TO service_role;
ALTER TABLE public.kot_submission_tickets ENABLE ROW LEVEL SECURITY;
-- No client policies: only the security-definer trigger below writes or reads it.

CREATE OR REPLACE FUNCTION public.dedupe_kot_submission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _submission text := NEW.payload->>'submissionId';
  _canonical text;
BEGIN
  IF NEW.kind <> 'kot' OR NEW.deleted OR _submission IS NULL OR _submission = '' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.kot_submission_tickets (restaurant_id, submission_id, station, ticket_kind, record_id)
  VALUES (NEW.restaurant_id, _submission, coalesce(NEW.payload->>'station', ''), coalesce(NEW.payload->>'kind', 'new'), NEW.record_id)
  ON CONFLICT DO NOTHING;
  SELECT record_id INTO _canonical FROM public.kot_submission_tickets
   WHERE restaurant_id = NEW.restaurant_id AND submission_id = _submission
     AND station = coalesce(NEW.payload->>'station', '') AND ticket_kind = coalesce(NEW.payload->>'kind', 'new');
  IF _canonical IS DISTINCT FROM NEW.record_id THEN
    RETURN NULL; -- duplicate logical ticket: silently skipped, also for legacy upserts
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.dedupe_kot_submission() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS restaurant_records_kot_dedupe ON public.restaurant_records;
CREATE TRIGGER restaurant_records_kot_dedupe
  BEFORE INSERT ON public.restaurant_records
  FOR EACH ROW EXECUTE FUNCTION public.dedupe_kot_submission();

-- 3. Payment ledger --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bill_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_uid text NOT NULL,
  payment_key text NOT NULL,
  mode text NOT NULL,
  amount numeric NOT NULL,
  settled_at timestamptz,
  recorded_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, order_uid, payment_key)
);
GRANT SELECT, INSERT ON public.bill_payments TO authenticated;
GRANT ALL ON public.bill_payments TO service_role;
ALTER TABLE public.bill_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read bill payments" ON public.bill_payments
  FOR SELECT TO authenticated USING (public.is_restaurant_member(restaurant_id));
CREATE POLICY "Members record bill payments" ON public.bill_payments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_restaurant_member(restaurant_id) AND recorded_by = auth.uid());

-- 4. Versioned, atomic push ------------------------------------------------------
-- _units: [{ "rows": [{ kind, record_id, payload, deleted, base_version }] }]
-- Each unit commits all-or-nothing (a settled bill, its sale stock entry and its
-- table release travel as one unit). Returns one result per row:
--   applied   { version }
--   duplicate { canonical_record_id }           (KOT already stored)
--   conflict  { version, payload, deleted }     (stale base_version)
--   rolled_back                                 (another row of the unit failed)
--   error     { code, message }                 (RLS / guard refusal etc.)
CREATE OR REPLACE FUNCTION public.push_restaurant_records(_restaurant_id uuid, _units jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  _unit jsonb;
  _row jsonb;
  _results jsonb := '[]'::jsonb;
  _unit_results jsonb;
  _kind text;
  _id text;
  _payload jsonb;
  _deleted boolean;
  _base bigint;
  _cur record;
  _version bigint;
  _canonical text;
  _failed_kind text;
  _failed_id text;
  _code text;
  _msg text;
  _detail text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_restaurant_member(_restaurant_id) THEN
    RAISE EXCEPTION 'Not a member of this restaurant' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_units) <> 'array' OR jsonb_array_length(_units) > 200 THEN
    RAISE EXCEPTION 'Invalid push batch' USING ERRCODE = '22023';
  END IF;

  FOR _unit IN SELECT value FROM jsonb_array_elements(_units) LOOP
    _unit_results := '[]'::jsonb;
    _failed_kind := NULL; _failed_id := NULL;
    BEGIN
      FOR _row IN SELECT value FROM jsonb_array_elements(_unit->'rows') LOOP
        _kind := _row->>'kind';
        _id := _row->>'record_id';
        _payload := coalesce(_row->'payload', '{}'::jsonb);
        _deleted := coalesce((_row->>'deleted')::boolean, false);
        _base := nullif(_row->>'base_version', '')::bigint;
        _failed_kind := _kind; _failed_id := _id;

        -- Idempotent KOT: a ticket already stored for this submission wins.
        IF _kind = 'kot' AND NOT _deleted AND coalesce(_payload->>'submissionId', '') <> '' THEN
          SELECT t.record_id INTO _canonical FROM public.kot_submission_tickets t
           WHERE t.restaurant_id = _restaurant_id AND t.submission_id = _payload->>'submissionId'
             AND t.station = coalesce(_payload->>'station', '') AND t.ticket_kind = coalesce(_payload->>'kind', 'new');
          IF _canonical IS NOT NULL AND _canonical <> _id THEN
            _unit_results := _unit_results || jsonb_build_object('kind', _kind, 'record_id', _id, 'status', 'duplicate', 'canonical_record_id', _canonical);
            CONTINUE;
          END IF;
        END IF;

        SELECT r.version, r.payload, r.deleted INTO _cur FROM public.restaurant_records r
         WHERE r.restaurant_id = _restaurant_id AND r.kind = _kind AND r.record_id = _id
         FOR UPDATE;

        IF NOT FOUND THEN
          INSERT INTO public.restaurant_records (restaurant_id, kind, record_id, payload, deleted, updated_by)
          VALUES (_restaurant_id, _kind, _id, _payload, _deleted, auth.uid())
          ON CONFLICT (restaurant_id, kind, record_id) DO NOTHING
          RETURNING version INTO _version;
          IF _version IS NULL THEN
            -- Lost an insert race (or the KOT trigger skipped a duplicate): let the client retry.
            RAISE EXCEPTION 'record_conflict' USING ERRCODE = '40001',
              DETAIL = jsonb_build_object('kind', _kind, 'record_id', _id, 'race', true)::text;
          END IF;
        ELSE
          -- Stale write: the client edited an older copy. Identical content is a retry, not a conflict.
          -- Bills with no known base (first push from an upgraded device) are also checked.
          IF ((_base IS NOT NULL AND _cur.version <> _base) OR (_base IS NULL AND _kind = 'order'))
             AND NOT (_cur.payload = _payload AND _cur.deleted = _deleted) THEN
            RAISE EXCEPTION 'record_conflict' USING ERRCODE = '40001',
              DETAIL = jsonb_build_object('kind', _kind, 'record_id', _id, 'version', _cur.version,
                                          'payload', _cur.payload, 'deleted', _cur.deleted)::text;
          END IF;
          IF _cur.payload = _payload AND _cur.deleted = _deleted THEN
            _version := _cur.version;
          ELSE
            UPDATE public.restaurant_records
               SET payload = _payload, deleted = _deleted, updated_by = auth.uid()
             WHERE restaurant_id = _restaurant_id AND kind = _kind AND record_id = _id
            RETURNING version INTO _version;
          END IF;
        END IF;

        -- Settlement: record each payment exactly once in the same transaction.
        IF _kind = 'order' AND NOT _deleted AND _payload->>'status' = 'settled'
           AND jsonb_typeof(_payload->'payments') = 'array' THEN
          INSERT INTO public.bill_payments (restaurant_id, order_uid, payment_key, mode, amount, settled_at, recorded_by)
          SELECT _restaurant_id, _id, (p.ord - 1)::text || ':' || coalesce(p.value->>'mode', ''),
                 coalesce(p.value->>'mode', ''), coalesce((p.value->>'amount')::numeric, 0),
                 CASE WHEN _payload ? 'settledAt' THEN to_timestamp((_payload->>'settledAt')::double precision / 1000) END,
                 auth.uid()
            FROM jsonb_array_elements(_payload->'payments') WITH ORDINALITY AS p(value, ord)
          ON CONFLICT (restaurant_id, order_uid, payment_key) DO NOTHING;
        END IF;

        _unit_results := _unit_results || jsonb_build_object('kind', _kind, 'record_id', _id, 'status', 'applied', 'version', _version);
      END LOOP;
      _results := _results || _unit_results;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS _code = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT, _detail = PG_EXCEPTION_DETAIL;
      -- The whole unit was rolled back; report the failing row and mark its siblings.
      FOR _row IN SELECT value FROM jsonb_array_elements(_unit->'rows') LOOP
        IF _row->>'kind' = _failed_kind AND _row->>'record_id' = _failed_id THEN
          IF _code = '40001' AND _msg = 'record_conflict' THEN
            _results := _results || (jsonb_build_object('status', 'conflict') || coalesce(_detail::jsonb, '{}'::jsonb)
                                     || jsonb_build_object('kind', _failed_kind, 'record_id', _failed_id));
          ELSE
            _results := _results || jsonb_build_object('kind', _failed_kind, 'record_id', _failed_id,
                                                       'status', 'error', 'code', _code, 'message', _msg);
          END IF;
        ELSE
          _results := _results || jsonb_build_object('kind', _row->>'kind', 'record_id', _row->>'record_id', 'status', 'rolled_back');
        END IF;
      END LOOP;
    END;
  END LOOP;
  RETURN _results;
END $$;

REVOKE ALL ON FUNCTION public.push_restaurant_records(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_restaurant_records(uuid, jsonb) TO authenticated;
