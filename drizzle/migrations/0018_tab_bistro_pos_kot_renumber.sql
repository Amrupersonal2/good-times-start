-- TAB Bistro numbering cutover.
-- Re-number genuine POS bills and logical KOT submissions from 0001.
-- QAF1 / Floor verification is operational test data: remove its active held
-- floor records, preserve settled/void audit history, and exclude it from the
-- numbering sequence. The section is derived from active table records.

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
    ) AS created_order
  FROM public.restaurant_records rr
  JOIN _tab_bistro_target target ON target.id = rr.restaurant_id
  WHERE rr.kind = 'kot'
    AND NOT rr.deleted
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

UPDATE public.restaurant_records rr
SET payload = jsonb_set(
  jsonb_set(
    jsonb_set(rr.payload, '{kotNo}', to_jsonb(km.new_kot_no), true),
    '{numberRequestId}', to_jsonb(km.request_id::text), true
  ),
  '{billNo}',
  to_jsonb(coalesce(parent.new_bill_no, rr.payload->>'billNo')),
  true
)
FROM _tab_bistro_kot_map km
LEFT JOIN LATERAL (
  SELECT p.new_bill_no
  FROM _tab_bistro_pos_map p
  WHERE p.restaurant_id = km.restaurant_id
    AND (p.record_id = (SELECT r.payload->>'orderUid'
                        FROM public.restaurant_records r
                        WHERE r.restaurant_id = km.restaurant_id
                          AND r.kind = 'kot'
                          AND coalesce(nullif(r.payload->>'submissionId', ''),
                            'legacy:' || coalesce(r.payload->>'orderUid', '') || ':' || coalesce(r.payload->>'createdAt', '')) = km.group_key
                        LIMIT 1)
         OR p.old_bill_no = (SELECT r.payload->>'billNo'
                             FROM public.restaurant_records r
                             WHERE r.restaurant_id = km.restaurant_id
                               AND r.kind = 'kot'
                               AND coalesce(nullif(r.payload->>'submissionId', ''),
                                 'legacy:' || coalesce(r.payload->>'orderUid', '') || ':' || coalesce(r.payload->>'createdAt', '')) = km.group_key
                             LIMIT 1))
  ORDER BY p.sequence_number
  LIMIT 1
) parent ON true
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
