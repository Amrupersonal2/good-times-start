-- TAB Bistro follow-up reconciliation for running bills and the QAF1 test fixture.
-- Migration 0018 performs the initial cutover. This forward migration repairs any
-- legacy-series running bills/KOTs that remained after that cutover (for example,
-- records retained by an older preview database), while preserving already-issued
-- POS/KOT numbers and all settled/void financial history.
--
-- QAF1 is a known floor-verification test fixture. Only its active held bill,
-- associated KOT tickets, and table record are tombstoned; settled/void records
-- are deliberately retained.

CREATE TEMP TABLE _tab_bistro_reconcile_target ON COMMIT DROP AS
SELECT id
FROM public.restaurants
WHERE lower(name) LIKE '%tab bistro%';

DO $$
BEGIN
  IF (SELECT count(*) FROM _tab_bistro_reconcile_target) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one TAB Bistro restaurant; refusing numbering reconciliation.';
  END IF;
  IF to_regclass('public.restaurant_number_sequences') IS NULL
     OR to_regclass('public.restaurant_number_allocations') IS NULL THEN
    RAISE EXCEPTION 'Run restaurant-wide numbering migration 0016 before migration 0019.';
  END IF;
END;
$$;

-- Map every active held bill. Already-issued POS numbers remain unchanged;
-- legacy SJT/D1/device-series numbers receive the next unused POS sequence.
CREATE TEMP TABLE _tab_bistro_reconcile_orders ON COMMIT DROP AS
WITH target AS (
  SELECT id AS restaurant_id FROM _tab_bistro_reconcile_target
),
pos_high_water AS (
  SELECT
    t.restaurant_id,
    greatest(
      coalesce((
        SELECT max((regexp_match(o.payload->>'billNo', '^POS/([0-9]+)$'))[1]::bigint)
        FROM public.restaurant_records o
        WHERE o.restaurant_id = t.restaurant_id
          AND o.kind = 'order'
          AND NOT o.deleted
          AND coalesce(o.payload->>'billNo', '') ~ '^POS/[0-9]{4,}$'
      ), 0),
      coalesce((
        SELECT s.last_sequence
        FROM public.restaurant_number_sequences s
        WHERE s.restaurant_id = t.restaurant_id AND s.series = 'POS'
      ), 0)
    ) AS high_water
  FROM target t
),
legacy_held AS (
  SELECT
    o.restaurant_id,
    o.record_id,
    o.payload->>'billNo' AS old_bill_no,
    row_number() OVER (
      PARTITION BY o.restaurant_id
      ORDER BY
        CASE WHEN coalesce(o.payload->>'createdAt', '') ~ '^[0-9]+([.][0-9]+)?$'
          THEN (o.payload->>'createdAt')::numeric
          ELSE extract(epoch FROM o.updated_at) * 1000
        END,
        o.record_id
    )::bigint AS legacy_offset
  FROM public.restaurant_records o
  JOIN target t ON t.restaurant_id = o.restaurant_id
  WHERE o.kind = 'order'
    AND NOT o.deleted
    AND o.payload->>'status' = 'held'
    AND coalesce(o.payload->>'tableLabel', '') <> 'QAF1'
    AND coalesce(o.payload->>'tableId', '') <> 'QAF1'
    AND lower(coalesce(o.payload->>'tableSection', '')) <> 'floor verification'
    AND coalesce(o.payload->>'billNo', '') !~ '^POS/[0-9]{4,}$'
)
SELECT
  o.restaurant_id,
  o.record_id,
  o.payload->>'billNo' AS old_bill_no,
  CASE
    WHEN coalesce(o.payload->>'billNo', '') ~ '^POS/[0-9]{4,}$' THEN o.payload->>'billNo'
    ELSE 'POS/' || lpad((h.high_water + l.legacy_offset)::text, 4, '0')
  END AS new_bill_no,
  CASE
    WHEN coalesce(o.payload->>'numberRequestId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (o.payload->>'numberRequestId')::uuid
    ELSE md5(o.restaurant_id::text || ':POS:' || o.record_id)::uuid
  END AS request_id,
  CASE
    WHEN coalesce(o.payload->>'billNo', '') ~ '^POS/[0-9]{4,}$'
      THEN substring(o.payload->>'billNo' from '/([0-9]+)$')::bigint
    ELSE h.high_water + l.legacy_offset
  END AS sequence_number
FROM public.restaurant_records o
JOIN target t ON t.restaurant_id = o.restaurant_id
JOIN pos_high_water h ON h.restaurant_id = o.restaurant_id
LEFT JOIN legacy_held l ON l.restaurant_id = o.restaurant_id AND l.record_id = o.record_id
WHERE o.kind = 'order'
  AND NOT o.deleted
  AND o.payload->>'status' = 'held'
  AND coalesce(o.payload->>'tableLabel', '') <> 'QAF1'
  AND coalesce(o.payload->>'tableId', '') <> 'QAF1'
  AND lower(coalesce(o.payload->>'tableSection', '')) <> 'floor verification';

-- A pending bill that already has POS numbering is retained; a legacy bill is
-- upgraded without touching its lines, totals, payments, or creation timestamp.
UPDATE public.restaurant_records o
SET payload = jsonb_set(
  jsonb_set(o.payload, '{billNo}', to_jsonb(m.new_bill_no), true),
  '{numberRequestId}', to_jsonb(m.request_id::text), true
)
FROM _tab_bistro_reconcile_orders m
WHERE o.restaurant_id = m.restaurant_id
  AND o.kind = 'order'
  AND o.record_id = m.record_id
  AND (
    o.payload->>'billNo' IS DISTINCT FROM m.new_bill_no
    OR o.payload->>'numberRequestId' IS DISTINCT FROM m.request_id::text
  );

-- Group station-specific tickets into one logical submission. Preserve any
-- existing KOT number; allocate only where a submission still has a legacy/missing
-- number. Every ticket in the same submission receives the same canonical bill/KOT.
CREATE TEMP TABLE _tab_bistro_reconcile_kots ON COMMIT DROP AS
WITH kot_groups AS (
  SELECT
    k.restaurant_id,
    coalesce(
      nullif(k.payload->>'submissionId', ''),
      'legacy:' || coalesce(k.payload->>'orderUid', '') || ':' || coalesce(k.payload->>'createdAt', '')
    ) AS group_key,
    min(k.payload->>'orderUid') AS order_uid,
    min(k.payload->>'billNo') AS old_bill_no,
    min(
      CASE WHEN coalesce(k.payload->>'createdAt', '') ~ '^[0-9]+([.][0-9]+)?$'
        THEN (k.payload->>'createdAt')::numeric
        ELSE extract(epoch FROM k.updated_at) * 1000
      END
    ) AS created_order,
    min(k.payload->>'kotNo') FILTER (
      WHERE coalesce(k.payload->>'kotNo', '') ~ '^KOT/[0-9]{4,}$'
    ) AS existing_kot_no,
    count(DISTINCT k.payload->>'kotNo') FILTER (
      WHERE coalesce(k.payload->>'kotNo', '') ~ '^KOT/[0-9]{4,}$'
    ) AS canonical_number_count
  FROM public.restaurant_records k
  JOIN _tab_bistro_reconcile_orders o
    ON o.restaurant_id = k.restaurant_id
   AND (
     k.payload->>'orderUid' = o.record_id
     OR (
       nullif(k.payload->>'orderUid', '') IS NULL
       AND k.payload->>'billNo' = o.old_bill_no
     )
   )
  WHERE k.kind = 'kot' AND NOT k.deleted
  GROUP BY k.restaurant_id, coalesce(
    nullif(k.payload->>'submissionId', ''),
    'legacy:' || coalesce(k.payload->>'orderUid', '') || ':' || coalesce(k.payload->>'createdAt', '')
  )
),
checked_groups AS (
  SELECT * FROM kot_groups
),
kot_high_water AS (
  SELECT
    t.id AS restaurant_id,
    greatest(
      coalesce((
        SELECT max((regexp_match(k.payload->>'kotNo', '^KOT/([0-9]+)$'))[1]::bigint)
        FROM public.restaurant_records k
        WHERE k.restaurant_id = t.id
          AND k.kind = 'kot'
          AND NOT k.deleted
          AND coalesce(k.payload->>'kotNo', '') ~ '^KOT/[0-9]{4,}$'
      ), 0),
      coalesce((
        SELECT s.last_sequence
        FROM public.restaurant_number_sequences s
        WHERE s.restaurant_id = t.id AND s.series = 'KOT'
      ), 0)
    ) AS high_water
  FROM _tab_bistro_reconcile_target t
),
missing_groups AS (
  SELECT
    g.*,
    row_number() OVER (
      PARTITION BY g.restaurant_id ORDER BY g.created_order, g.group_key
    )::bigint AS missing_offset
  FROM checked_groups g
  WHERE g.existing_kot_no IS NULL
),
numbered_groups AS (
  SELECT
    g.restaurant_id,
    g.group_key,
    g.order_uid,
    g.old_bill_no,
    g.existing_kot_no AS new_kot_no,
    CASE
      WHEN coalesce(g.first_request_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN g.first_request_id::uuid
      ELSE md5(g.restaurant_id::text || ':KOT:' || g.group_key)::uuid
    END AS request_id,
    substring(g.existing_kot_no from '/([0-9]+)$')::bigint AS sequence_number,
    g.canonical_number_count
  FROM (
    SELECT
      g.*,
      min(k.payload->>'numberRequestId') AS first_request_id
    FROM checked_groups g
    JOIN public.restaurant_records k
      ON k.restaurant_id = g.restaurant_id
     AND k.kind = 'kot'
     AND NOT k.deleted
     AND coalesce(nullif(k.payload->>'submissionId', ''),
       'legacy:' || coalesce(k.payload->>'orderUid', '') || ':' || coalesce(k.payload->>'createdAt', '')) = g.group_key
    GROUP BY g.restaurant_id, g.group_key, g.order_uid, g.old_bill_no, g.created_order, g.existing_kot_no, g.canonical_number_count
  ) g
  WHERE g.existing_kot_no IS NOT NULL

  UNION ALL

  SELECT
    g.restaurant_id,
    g.group_key,
    g.order_uid,
    g.old_bill_no,
    'KOT/' || lpad((h.high_water + g.missing_offset)::text, 4, '0') AS new_kot_no,
    md5(g.restaurant_id::text || ':KOT:' || g.group_key)::uuid AS request_id,
    h.high_water + g.missing_offset AS sequence_number,
    g.canonical_number_count
  FROM missing_groups g
  JOIN kot_high_water h ON h.restaurant_id = g.restaurant_id
)
SELECT * FROM numbered_groups;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM _tab_bistro_reconcile_kots
    WHERE new_kot_no IS NULL OR sequence_number IS NULL OR canonical_number_count > 1
  ) THEN
    RAISE EXCEPTION 'Could not safely map every pending KOT submission.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM _tab_bistro_reconcile_kots
    GROUP BY restaurant_id, group_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate logical KOT submission mapping detected.';
  END IF;
END;
$$;

UPDATE public.restaurant_records k
SET payload = jsonb_set(
  jsonb_set(
    jsonb_set(k.payload, '{kotNo}', to_jsonb(m.new_kot_no), true),
    '{numberRequestId}', to_jsonb(m.request_id::text), true
  ),
  '{billNo}', to_jsonb(o.new_bill_no), true
)
FROM _tab_bistro_reconcile_kots m
JOIN _tab_bistro_reconcile_orders o
  ON o.restaurant_id = m.restaurant_id
 AND (
   o.record_id = m.order_uid
   OR (nullif(m.order_uid, '') IS NULL AND o.old_bill_no = m.old_bill_no)
 )
WHERE k.restaurant_id = m.restaurant_id
  AND k.kind = 'kot'
  AND NOT k.deleted
  AND coalesce(nullif(k.payload->>'submissionId', ''),
    'legacy:' || coalesce(k.payload->>'orderUid', '') || ':' || coalesce(k.payload->>'createdAt', '')) = m.group_key;

-- Rebuild receipts for the active bills/submissions being reconciled.
-- Delete only allocations for the exact sequences represented by these active
-- records, then restore their deterministic request IDs. This also repairs a
-- canonical bill/KOT whose receipt row was missing.
DELETE FROM public.restaurant_number_allocations a
USING _tab_bistro_reconcile_orders m
WHERE a.restaurant_id = m.restaurant_id
  AND a.series = 'POS'
  AND a.sequence_number = m.sequence_number;

INSERT INTO public.restaurant_number_allocations
  (restaurant_id, series, request_id, sequence_number)
SELECT restaurant_id, 'POS', request_id, sequence_number
FROM _tab_bistro_reconcile_orders;

DELETE FROM public.restaurant_number_allocations a
USING _tab_bistro_reconcile_kots m
WHERE a.restaurant_id = m.restaurant_id
  AND a.series = 'KOT'
  AND a.sequence_number = m.sequence_number;

INSERT INTO public.restaurant_number_allocations
  (restaurant_id, series, request_id, sequence_number)
SELECT restaurant_id, 'KOT', request_id, sequence_number
FROM _tab_bistro_reconcile_kots;

INSERT INTO public.restaurant_number_sequences (restaurant_id, series, last_sequence)
SELECT
  t.id,
  'POS',
  greatest(
    coalesce((SELECT max((regexp_match(o.payload->>'billNo', '^POS/([0-9]+)$'))[1]::bigint)
      FROM public.restaurant_records o WHERE o.restaurant_id = t.id AND o.kind = 'order' AND NOT o.deleted
        AND coalesce(o.payload->>'billNo', '') ~ '^POS/[0-9]{4,}$'), 0),
    coalesce((SELECT max(a.sequence_number) FROM public.restaurant_number_allocations a
      WHERE a.restaurant_id = t.id AND a.series = 'POS'), 0)
  )
FROM _tab_bistro_reconcile_target t
ON CONFLICT (restaurant_id, series)
DO UPDATE SET last_sequence = greatest(public.restaurant_number_sequences.last_sequence, EXCLUDED.last_sequence),
              updated_at = clock_timestamp();

INSERT INTO public.restaurant_number_sequences (restaurant_id, series, last_sequence)
SELECT
  t.id,
  'KOT',
  greatest(
    coalesce((SELECT max((regexp_match(k.payload->>'kotNo', '^KOT/([0-9]+)$'))[1]::bigint)
      FROM public.restaurant_records k WHERE k.restaurant_id = t.id AND k.kind = 'kot' AND NOT k.deleted
        AND coalesce(k.payload->>'kotNo', '') ~ '^KOT/[0-9]{4,}$'), 0),
    coalesce((SELECT max(a.sequence_number) FROM public.restaurant_number_allocations a
      WHERE a.restaurant_id = t.id AND a.series = 'KOT'), 0)
  )
FROM _tab_bistro_reconcile_target t
ON CONFLICT (restaurant_id, series)
DO UPDATE SET last_sequence = greatest(public.restaurant_number_sequences.last_sequence, EXCLUDED.last_sequence),
              updated_at = clock_timestamp();

-- Remove only the known QAF1 / floor-verification test fixture from active
-- operations. Keep any settled/void order history untouched.
UPDATE public.restaurant_records k
SET deleted = true
WHERE k.kind = 'kot'
  AND NOT k.deleted
  AND k.restaurant_id IN (SELECT id FROM _tab_bistro_reconcile_target)
  AND (
    coalesce(k.payload->>'tableLabel', '') = 'QAF1'
    OR coalesce(k.payload->>'tableId', '') = 'QAF1'
    OR lower(coalesce(k.payload->>'tableSection', '')) = 'floor verification'
    OR k.payload->>'orderUid' IN (
      SELECT o.record_id
      FROM public.restaurant_records o
      WHERE o.restaurant_id = k.restaurant_id
        AND o.kind = 'order'
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
  AND o.restaurant_id IN (SELECT id FROM _tab_bistro_reconcile_target)
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
  AND t.restaurant_id IN (SELECT id FROM _tab_bistro_reconcile_target)
  AND (
    coalesce(t.payload->>'label', '') = 'QAF1'
    OR coalesce(t.payload->>'id', '') = 'QAF1'
    OR lower(coalesce(t.payload->>'section', '')) = 'floor verification'
    OR t.record_id = 'QAF1'
  );

        THEN g.first_request_id::uuid
      ELSE md5(g.restaurant_id::text || ':KOT:' || g.group_key)::uuid
    END AS request_id,
    substring(g.existing_kot_no from '/([0-9]+)
  FROM (
    SELECT
      g.*,
      min(k.payload->>'numberRequestId') AS first_request_id
    FROM checked_groups g
    JOIN public.restaurant_records k
      ON k.restaurant_id = g.restaurant_id
     AND k.kind = 'kot'
     AND NOT k.deleted
     AND coalesce(nullif(k.payload->>'submissionId', ''),
       'legacy:' || coalesce(k.payload->>'orderUid', '') || ':' || coalesce(k.payload->>'createdAt', '')) = g.group_key
    GROUP BY g.restaurant_id, g.group_key, g.order_uid, g.old_bill_no, g.created_order, g.existing_kot_no, g.canonical_number_count
  ) g
  WHERE g.existing_kot_no IS NOT NULL

  UNION ALL

  SELECT
    g.restaurant_id,
    g.group_key,
    g.order_uid,
    g.old_bill_no,
    'KOT/' || lpad((h.high_water + g.missing_offset)::text, 4, '0') AS new_kot_no,
    md5(g.restaurant_id::text || ':KOT:' || g.group_key)::uuid AS request_id,
    h.high_water + g.missing_offset AS sequence_number,
    g.canonical_number_count
  FROM missing_groups g
  JOIN kot_high_water h ON h.restaurant_id = g.restaurant_id
)
SELECT * FROM numbered_groups;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM _tab_bistro_reconcile_kots
    WHERE new_kot_no IS NULL OR sequence_number IS NULL OR canonical_number_count > 1
  ) THEN
    RAISE EXCEPTION 'Could not safely map every pending KOT submission.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM _tab_bistro_reconcile_kots
    GROUP BY restaurant_id, group_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate logical KOT submission mapping detected.';
  END IF;
END;
$$;

UPDATE public.restaurant_records k
SET payload = jsonb_set(
  jsonb_set(
    jsonb_set(k.payload, '{kotNo}', to_jsonb(m.new_kot_no), true),
    '{numberRequestId}', to_jsonb(m.request_id::text), true
  ),
  '{billNo}', to_jsonb(o.new_bill_no), true
)
FROM _tab_bistro_reconcile_kots m
JOIN _tab_bistro_reconcile_orders o
  ON o.restaurant_id = m.restaurant_id
 AND (
   o.record_id = m.order_uid
   OR (nullif(m.order_uid, '') IS NULL AND o.old_bill_no = m.old_bill_no)
 )
WHERE k.restaurant_id = m.restaurant_id
  AND k.kind = 'kot'
  AND NOT k.deleted
  AND coalesce(nullif(k.payload->>'submissionId', ''),
    'legacy:' || coalesce(k.payload->>'orderUid', '') || ':' || coalesce(k.payload->>'createdAt', '')) = m.group_key;

-- Persist allocator receipts for any legacy records just upgraded. The
-- high-water marks never move backwards and canonical existing numbers survive.
INSERT INTO public.restaurant_number_allocations
  (restaurant_id, series, request_id, sequence_number)
SELECT restaurant_id, 'POS', request_id, sequence_number
FROM _tab_bistro_reconcile_orders
WHERE old_bill_no !~ '^POS/[0-9]{4,}$'
ON CONFLICT (restaurant_id, series, request_id)
DO UPDATE SET sequence_number = EXCLUDED.sequence_number;

INSERT INTO public.restaurant_number_allocations
  (restaurant_id, series, request_id, sequence_number)
SELECT restaurant_id, 'KOT', request_id, sequence_number
FROM _tab_bistro_reconcile_kots
WHERE existing_kot_no IS NULL
ON CONFLICT (restaurant_id, series, request_id)
DO UPDATE SET sequence_number = EXCLUDED.sequence_number;

INSERT INTO public.restaurant_number_sequences (restaurant_id, series, last_sequence)
SELECT
  t.id,
  'POS',
  greatest(
    coalesce((SELECT max((regexp_match(o.payload->>'billNo', '^POS/([0-9]+)$'))[1]::bigint)
      FROM public.restaurant_records o WHERE o.restaurant_id = t.id AND o.kind = 'order' AND NOT o.deleted
        AND coalesce(o.payload->>'billNo', '') ~ '^POS/[0-9]{4,}$'), 0),
    coalesce((SELECT max(a.sequence_number) FROM public.restaurant_number_allocations a
      WHERE a.restaurant_id = t.id AND a.series = 'POS'), 0)
  )
FROM _tab_bistro_reconcile_target t
ON CONFLICT (restaurant_id, series)
DO UPDATE SET last_sequence = greatest(public.restaurant_number_sequences.last_sequence, EXCLUDED.last_sequence),
              updated_at = clock_timestamp();

INSERT INTO public.restaurant_number_sequences (restaurant_id, series, last_sequence)
SELECT
  t.id,
  'KOT',
  greatest(
    coalesce((SELECT max((regexp_match(k.payload->>'kotNo', '^KOT/([0-9]+)$'))[1]::bigint)
      FROM public.restaurant_records k WHERE k.restaurant_id = t.id AND k.kind = 'kot' AND NOT k.deleted
        AND coalesce(k.payload->>'kotNo', '') ~ '^KOT/[0-9]{4,}$'), 0),
    coalesce((SELECT max(a.sequence_number) FROM public.restaurant_number_allocations a
      WHERE a.restaurant_id = t.id AND a.series = 'KOT'), 0)
  )
FROM _tab_bistro_reconcile_target t
ON CONFLICT (restaurant_id, series)
DO UPDATE SET last_sequence = greatest(public.restaurant_number_sequences.last_sequence, EXCLUDED.last_sequence),
              updated_at = clock_timestamp();

-- Remove only the known QAF1 / floor-verification test fixture from active
-- operations. Keep any settled/void order history untouched.
UPDATE public.restaurant_records k
SET deleted = true
WHERE k.kind = 'kot'
  AND NOT k.deleted
  AND k.restaurant_id IN (SELECT id FROM _tab_bistro_reconcile_target)
  AND (
    coalesce(k.payload->>'tableLabel', '') = 'QAF1'
    OR coalesce(k.payload->>'tableId', '') = 'QAF1'
    OR lower(coalesce(k.payload->>'tableSection', '')) = 'floor verification'
    OR k.payload->>'orderUid' IN (
      SELECT o.record_id
      FROM public.restaurant_records o
      WHERE o.restaurant_id = k.restaurant_id
        AND o.kind = 'order'
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
  AND o.restaurant_id IN (SELECT id FROM _tab_bistro_reconcile_target)
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
  AND t.restaurant_id IN (SELECT id FROM _tab_bistro_reconcile_target)
  AND (
    coalesce(t.payload->>'label', '') = 'QAF1'
    OR coalesce(t.payload->>'id', '') = 'QAF1'
    OR lower(coalesce(t.payload->>'section', '')) = 'floor verification'
    OR t.record_id = 'QAF1'
  );
)::bigint AS sequence_number,
    g.canonical_number_count
  FROM (
    SELECT
      g.*,
      min(k.payload->>'numberRequestId') AS first_request_id
    FROM checked_groups g
    JOIN public.restaurant_records k
      ON k.restaurant_id = g.restaurant_id
     AND k.kind = 'kot'
     AND NOT k.deleted
     AND coalesce(nullif(k.payload->>'submissionId', ''),
       'legacy:' || coalesce(k.payload->>'orderUid', '') || ':' || coalesce(k.payload->>'createdAt', '')) = g.group_key
    GROUP BY g.restaurant_id, g.group_key, g.order_uid, g.old_bill_no, g.created_order, g.existing_kot_no, g.canonical_number_count
  ) g
  WHERE g.existing_kot_no IS NOT NULL

  UNION ALL

  SELECT
    g.restaurant_id,
    g.group_key,
    g.order_uid,
    g.old_bill_no,
    'KOT/' || lpad((h.high_water + g.missing_offset)::text, 4, '0') AS new_kot_no,
    md5(g.restaurant_id::text || ':KOT:' || g.group_key)::uuid AS request_id,
    h.high_water + g.missing_offset AS sequence_number,
    g.canonical_number_count
  FROM missing_groups g
  JOIN kot_high_water h ON h.restaurant_id = g.restaurant_id
)
SELECT * FROM numbered_groups;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM _tab_bistro_reconcile_kots
    WHERE new_kot_no IS NULL OR sequence_number IS NULL OR canonical_number_count > 1
  ) THEN
    RAISE EXCEPTION 'Could not safely map every pending KOT submission.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM _tab_bistro_reconcile_kots
    GROUP BY restaurant_id, group_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate logical KOT submission mapping detected.';
  END IF;
END;
$$;

UPDATE public.restaurant_records k
SET payload = jsonb_set(
  jsonb_set(
    jsonb_set(k.payload, '{kotNo}', to_jsonb(m.new_kot_no), true),
    '{numberRequestId}', to_jsonb(m.request_id::text), true
  ),
  '{billNo}', to_jsonb(o.new_bill_no), true
)
FROM _tab_bistro_reconcile_kots m
JOIN _tab_bistro_reconcile_orders o
  ON o.restaurant_id = m.restaurant_id
 AND (
   o.record_id = m.order_uid
   OR (nullif(m.order_uid, '') IS NULL AND o.old_bill_no = m.old_bill_no)
 )
WHERE k.restaurant_id = m.restaurant_id
  AND k.kind = 'kot'
  AND NOT k.deleted
  AND coalesce(nullif(k.payload->>'submissionId', ''),
    'legacy:' || coalesce(k.payload->>'orderUid', '') || ':' || coalesce(k.payload->>'createdAt', '')) = m.group_key;

-- Persist allocator receipts for any legacy records just upgraded. The
-- high-water marks never move backwards and canonical existing numbers survive.
INSERT INTO public.restaurant_number_allocations
  (restaurant_id, series, request_id, sequence_number)
SELECT restaurant_id, 'POS', request_id, sequence_number
FROM _tab_bistro_reconcile_orders
WHERE old_bill_no !~ '^POS/[0-9]{4,}$'
ON CONFLICT (restaurant_id, series, request_id)
DO UPDATE SET sequence_number = EXCLUDED.sequence_number;

INSERT INTO public.restaurant_number_allocations
  (restaurant_id, series, request_id, sequence_number)
SELECT restaurant_id, 'KOT', request_id, sequence_number
FROM _tab_bistro_reconcile_kots
WHERE existing_kot_no IS NULL
ON CONFLICT (restaurant_id, series, request_id)
DO UPDATE SET sequence_number = EXCLUDED.sequence_number;

INSERT INTO public.restaurant_number_sequences (restaurant_id, series, last_sequence)
SELECT
  t.id,
  'POS',
  greatest(
    coalesce((SELECT max((regexp_match(o.payload->>'billNo', '^POS/([0-9]+)$'))[1]::bigint)
      FROM public.restaurant_records o WHERE o.restaurant_id = t.id AND o.kind = 'order' AND NOT o.deleted
        AND coalesce(o.payload->>'billNo', '') ~ '^POS/[0-9]{4,}$'), 0),
    coalesce((SELECT max(a.sequence_number) FROM public.restaurant_number_allocations a
      WHERE a.restaurant_id = t.id AND a.series = 'POS'), 0)
  )
FROM _tab_bistro_reconcile_target t
ON CONFLICT (restaurant_id, series)
DO UPDATE SET last_sequence = greatest(public.restaurant_number_sequences.last_sequence, EXCLUDED.last_sequence),
              updated_at = clock_timestamp();

INSERT INTO public.restaurant_number_sequences (restaurant_id, series, last_sequence)
SELECT
  t.id,
  'KOT',
  greatest(
    coalesce((SELECT max((regexp_match(k.payload->>'kotNo', '^KOT/([0-9]+)$'))[1]::bigint)
      FROM public.restaurant_records k WHERE k.restaurant_id = t.id AND k.kind = 'kot' AND NOT k.deleted
        AND coalesce(k.payload->>'kotNo', '') ~ '^KOT/[0-9]{4,}$'), 0),
    coalesce((SELECT max(a.sequence_number) FROM public.restaurant_number_allocations a
      WHERE a.restaurant_id = t.id AND a.series = 'KOT'), 0)
  )
FROM _tab_bistro_reconcile_target t
ON CONFLICT (restaurant_id, series)
DO UPDATE SET last_sequence = greatest(public.restaurant_number_sequences.last_sequence, EXCLUDED.last_sequence),
              updated_at = clock_timestamp();

-- Remove only the known QAF1 / floor-verification test fixture from active
-- operations. Keep any settled/void order history untouched.
UPDATE public.restaurant_records k
SET deleted = true
WHERE k.kind = 'kot'
  AND NOT k.deleted
  AND k.restaurant_id IN (SELECT id FROM _tab_bistro_reconcile_target)
  AND (
    coalesce(k.payload->>'tableLabel', '') = 'QAF1'
    OR coalesce(k.payload->>'tableId', '') = 'QAF1'
    OR lower(coalesce(k.payload->>'tableSection', '')) = 'floor verification'
    OR k.payload->>'orderUid' IN (
      SELECT o.record_id
      FROM public.restaurant_records o
      WHERE o.restaurant_id = k.restaurant_id
        AND o.kind = 'order'
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
  AND o.restaurant_id IN (SELECT id FROM _tab_bistro_reconcile_target)
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
  AND t.restaurant_id IN (SELECT id FROM _tab_bistro_reconcile_target)
  AND (
    coalesce(t.payload->>'label', '') = 'QAF1'
    OR coalesce(t.payload->>'id', '') = 'QAF1'
    OR lower(coalesce(t.payload->>'section', '')) = 'floor verification'
    OR t.record_id = 'QAF1'
  );
