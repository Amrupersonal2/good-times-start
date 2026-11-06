-- TAB Bistro numbering cutover.
-- The verified live dataset contains four running (held), unpaid bills and
-- nine logical KOT submissions (16 station tickets); there are no settled bills.
-- Renumber only those running bills and their active KOT tickets from 0001.
-- Abort if a settled/void/non-running bill appears before deployment, so this
-- migration cannot silently rewrite a later settlement or historical report.
-- QAF1 / Floor verification is operational test data and is excluded entirely.

CREATE TEMP TABLE _tab_bistro_target ON COMMIT DROP AS
SELECT id
FROM public.restaurants
WHERE lower(name) LIKE '%tab bistro%';

DO $$
BEGIN
  IF (SELECT count(*) FROM _tab_bistro_target) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one TAB Bistro restaurant; refusing numbering cutover.';
  END IF;
  IF to_regclass('public.restaurant_number_sequences') IS NULL
     OR to_regclass('public.restaurant_number_allocations') IS NULL THEN
    RAISE EXCEPTION 'Run migration 0016 before TAB Bistro numbering cutover.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.restaurant_records rr
    JOIN _tab_bistro_target target ON target.id = rr.restaurant_id
    WHERE rr.kind = 'order'
      AND NOT rr.deleted
      AND coalesce(rr.payload->>'tableLabel', '') <> 'QAF1'
      AND coalesce(rr.payload->>'tableId', '') <> 'QAF1'
      AND lower(coalesce(rr.payload->>'tableSection', '')) <> 'floor verification'
      AND coalesce(rr.payload->>'status', '') <> 'held'
  ) THEN
    RAISE EXCEPTION 'Expected only running/held TAB Bistro bills. Reconcile any settled or void records before renumbering.';
  END IF;
END;
$$;

CREATE TEMP TABLE _tab_bistro_pos_map ON COMMIT DROP AS
SELECT
  rr.restaurant_id,
  rr.record_id,
  rr.payload->>'billNo' AS old_bill_no,
  row_number() OVER (
    ORDER BY
      CASE WHEN coalesce(rr.payload->>'createdAt', '') ~ '^[0-9]+(\.[0-9]+)?$'
        THEN (rr.payload->>'createdAt')::numeric
        ELSE extract(epoch FROM rr.updated_at) * 1000
      END,
      rr.record_id
  )::bigint AS sequence_number,
  ('POS/' || lpad(row_number() OVER (
    ORDER BY
      CASE WHEN coalesce(rr.payload->>'createdAt', '') ~ '^[0-9]+(\.[0-9]+)?$'
        THEN (rr.payload->>'createdAt')::numeric
        ELSE extract(epoch FROM rr.updated_at) * 1000
      END,
      rr.record_id
  )::text, 4, '0')) AS new_bill_no,
  md5(rr.restaurant_id::text || ':POS:' || rr.record_id)::uuid AS request_id
FROM public.restaurant_records rr
JOIN _tab_bistro_target target ON target.id = rr.restaurant_id
WHERE rr.kind = 'order'
  AND NOT rr.deleted
  AND rr.payload->>'status' = 'held'
  AND coalesce(rr.payload->>'tableLabel', '') <> 'QAF1'
  AND coalesce(rr.payload->>'tableId', '') <> 'QAF1'
  AND lower(coalesce(rr.payload->>'tableSection', '')) <> 'floor verification';

CREATE TEMP TABLE _tab_bistro_kot_map ON COMMIT DROP AS
WITH kot_groups AS (
  SELECT
    rr.restaurant_id,
    coalesce(
      nullif(rr.payload->>'submissionId', ''),
      'legacy:' || coalesce(rr.payload->>'orderUid', '') || ':' || coalesce(rr.payload->>'createdAt', '')
    ) AS group_key,
    min(
      CASE WHEN coalesce(rr.payload->>'createdAt', '') ~ '^[0-9]+(\.[0-9]+)?$'
        THEN (rr.payload->>'createdAt')::numeric
        ELSE extract(epoch FROM rr.updated_at) * 1000
      END
    ) AS created_order,
    min(rr.payload->>'orderUid') AS order_uid,
    min(rr.payload->>'billNo') AS old_bill_no
  FROM public.restaurant_records rr
  JOIN _tab_bistro_target target ON target.id = rr.restaurant_id
  WHERE rr.kind = 'kot'
    AND NOT rr.deleted
    AND EXISTS (
      SELECT 1 FROM public.restaurant_records running_order
      WHERE running_order.restaurant_id = rr.restaurant_id
        AND running_order.kind = 'order'
        AND NOT running_order.deleted
        AND running_order.payload->>'status' = 'held'
        AND coalesce(running_order.payload->>'tableLabel', '') <> 'QAF1'
        AND coalesce(running_order.payload->>'tableId', '') <> 'QAF1'
        AND lower(coalesce(running_order.payload->>'tableSection', '')) <> 'floor verification'
        AND running_order.record_id = rr.payload->>'orderUid'
    )
    AND coalesce(rr.payload->>'tableLabel', '') <> 'QAF1'
    AND coalesce(rr.payload->>'tableId', '') <> 'QAF1'
    AND lower(coalesce(rr.payload->>'tableSection', '')) <> 'floor verification'
  GROUP BY rr.restaurant_id, coalesce(
    nullif(rr.payload->>'submissionId', ''),
    'legacy:' || coalesce(rr.payload->>'orderUid', '') || ':' || coalesce(rr.payload->>'createdAt', '')
  )
)
SELECT
  restaurant_id,
  group_key,
  order_uid,
  old_bill_no,
  row_number() OVER (ORDER BY created_order, group_key)::bigint AS sequence_number,
  'KOT/' || lpad(row_number() OVER (ORDER BY created_order, group_key)::text, 4, '0') AS new_kot_no,
  md5(restaurant_id::text || ':KOT:' || group_key)::uuid AS request_id
FROM kot_groups;

-- Pause the guard only during this privileged, deterministic rewrite.
DROP TRIGGER IF EXISTS restaurant_records_numbering_guard ON public.restaurant_records;

UPDATE public.restaurant_records rr
SET payload = jsonb_set(
  jsonb_set(rr.payload, '{billNo}', to_jsonb(m.new_bill_no), true),
  '{numberRequestId}', to_jsonb(m.request_id::text), true
)
FROM _tab_bistro_pos_map m
WHERE rr.restaurant_id = m.restaurant_id
  AND rr.kind = 'order'
  AND rr.record_id = m.record_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.restaurant_records kot
    JOIN _tab_bistro_target target ON target.id = kot.restaurant_id
    WHERE kot.kind = 'kot'
      AND NOT kot.deleted
      AND coalesce(kot.payload->>'tableLabel', '') <> 'QAF1'
      AND coalesce(kot.payload->>'tableId', '') <> 'QAF1'
      AND lower(coalesce(kot.payload->>'tableSection', '')) <> 'floor verification'
      AND NOT EXISTS (
        SELECT 1 FROM public.restaurant_records qaf_order
        WHERE qaf_order.restaurant_id = kot.restaurant_id
          AND qaf_order.kind = 'order'
          AND qaf_order.payload->>'status' = 'held'
          AND qaf_order.record_id = kot.payload->>'orderUid'
          AND (
            coalesce(qaf_order.payload->>'tableLabel', '') = 'QAF1'
            OR coalesce(qaf_order.payload->>'tableId', '') = 'QAF1'
            OR lower(coalesce(qaf_order.payload->>'tableSection', '')) = 'floor verification'
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.restaurant_records running_order
        WHERE running_order.restaurant_id = kot.restaurant_id
          AND running_order.kind = 'order'
          AND NOT running_order.deleted
          AND running_order.payload->>'status' = 'held'
          AND coalesce(running_order.payload->>'tableLabel', '') <> 'QAF1'
          AND coalesce(running_order.payload->>'tableId', '') <> 'QAF1'
          AND lower(coalesce(running_order.payload->>'tableSection', '')) <> 'floor verification'
          AND running_order.record_id = kot.payload->>'orderUid'
      )
  ) THEN
    RAISE EXCEPTION 'Found an active genuine KOT without a matching held bill; reconcile it before renumbering.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM _tab_bistro_kot_map km
    LEFT JOIN _tab_bistro_pos_map pm
      ON pm.restaurant_id = km.restaurant_id
     AND (pm.record_id = km.order_uid OR pm.old_bill_no = km.old_bill_no)
    WHERE pm.record_id IS NULL
  ) THEN
    RAISE EXCEPTION 'A KOT submission has no mapped parent POS bill; refusing partial renumbering.';
  END IF;
END;
$$;

UPDATE public.restaurant_records rr
SET payload = jsonb_set(
  jsonb_set(
    jsonb_set(rr.payload, '{kotNo}', to_jsonb(km.new_kot_no), true),
    '{numberRequestId}', to_jsonb(km.request_id::text), true
  ),
  '{billNo}', to_jsonb(pm.new_bill_no), true
)
FROM _tab_bistro_kot_map km
JOIN _tab_bistro_pos_map pm
  ON pm.restaurant_id = km.restaurant_id
 AND (pm.record_id = km.order_uid OR pm.old_bill_no = km.old_bill_no)
WHERE rr.restaurant_id = km.restaurant_id
  AND rr.kind = 'kot'
  AND NOT rr.deleted
  AND coalesce(nullif(rr.payload->>'submissionId', ''),
    'legacy:' || coalesce(rr.payload->>'orderUid', '') || ':' || coalesce(rr.payload->>'createdAt', '')) = km.group_key;

-- Rebuild the durable receipts to match the new canonical values.
DELETE FROM public.restaurant_number_allocations a
USING _tab_bistro_target t
WHERE a.restaurant_id = t.id AND a.series IN ('POS', 'KOT');

DELETE FROM public.restaurant_number_sequences s
USING _tab_bistro_target t
WHERE s.restaurant_id = t.id AND s.series IN ('POS', 'KOT');

INSERT INTO public.restaurant_number_allocations (restaurant_id, series, request_id, sequence_number)
SELECT restaurant_id, 'POS', request_id, sequence_number FROM _tab_bistro_pos_map;

INSERT INTO public.restaurant_number_allocations (restaurant_id, series, request_id, sequence_number)
SELECT restaurant_id, 'KOT', request_id, sequence_number FROM _tab_bistro_kot_map;

INSERT INTO public.restaurant_number_sequences (restaurant_id, series, last_sequence)
SELECT id, 'POS', (SELECT coalesce(max(sequence_number), 0) FROM _tab_bistro_pos_map)
FROM _tab_bistro_target
UNION ALL
SELECT id, 'KOT', (SELECT coalesce(max(sequence_number), 0) FROM _tab_bistro_kot_map)
FROM _tab_bistro_target;

-- Remove the QAF1 floor-verification fixture from active operations. Keep its
-- settled/void history intact and never assign it a new POS/KOT number.
UPDATE public.restaurant_records kot
SET deleted = true
WHERE kot.kind = 'kot'
  AND NOT kot.deleted
  AND kot.restaurant_id IN (SELECT id FROM _tab_bistro_target)
  AND (
    coalesce(kot.payload->>'tableLabel', '') = 'QAF1'
    OR coalesce(kot.payload->>'tableId', '') = 'QAF1'
    OR lower(coalesce(kot.payload->>'tableSection', '')) = 'floor verification'
    OR kot.payload->>'orderUid' IN (
      SELECT o.record_id
      FROM public.restaurant_records o
      WHERE o.restaurant_id = kot.restaurant_id
        AND o.kind = 'order'
        AND NOT o.deleted
        AND o.payload->>'status' = 'held'
        AND (
          coalesce(o.payload->>'tableLabel', '') = 'QAF1'
          OR coalesce(o.payload->>'tableId', '') = 'QAF1'
          OR lower(coalesce(o.payload->>'tableSection', '')) = 'floor verification'
        )
    )
  );

UPDATE public.restaurant_records o
SET deleted = true
WHERE o.kind = 'order'
  AND NOT o.deleted
  AND o.restaurant_id IN (SELECT id FROM _tab_bistro_target)
  AND o.payload->>'status' = 'held'
  AND (
    coalesce(o.payload->>'tableLabel', '') = 'QAF1'
    OR coalesce(o.payload->>'tableId', '') = 'QAF1'
    OR lower(coalesce(o.payload->>'tableSection', '')) = 'floor verification'
  );

UPDATE public.restaurant_records t
SET deleted = true
WHERE t.kind = 'table'
  AND NOT t.deleted
  AND t.restaurant_id IN (SELECT id FROM _tab_bistro_target)
  AND (
    coalesce(t.payload->>'label', '') = 'QAF1'
    OR coalesce(t.payload->>'id', '') = 'QAF1'
    OR lower(coalesce(t.payload->>'section', '')) = 'floor verification'
  );

CREATE TRIGGER restaurant_records_numbering_guard
  BEFORE INSERT OR UPDATE ON public.restaurant_records
  FOR EACH ROW EXECUTE FUNCTION public.guard_restaurant_numbered_records();
