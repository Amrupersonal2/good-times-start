-- One-time, guarded TAB Bistro cleanup. This migration intentionally aborts
-- unless the live records still match the exact preflight snapshot.
DO $$
DECLARE
  active_orders integer;
  active_kots integer;
  qa_kots integer;
  qa_submissions integer;
  genuine_kots integer;
  genuine_submissions integer;
  qaf_table_count integer;
BEGIN
  -- Idempotent re-run: the target state is already in place.
  IF EXISTS (
    SELECT 1 FROM public.restaurant_records
    WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
      AND kind = 'order'
      AND record_id = '3f1d03f2-318b-4ebe-8f18-1c7281dab4b2'
      AND deleted
  ) THEN
    IF EXISTS (
      SELECT 1 FROM public.restaurant_number_sequences
      WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
        AND series = 'POS' AND last_sequence = 3
    ) AND EXISTS (
      SELECT 1 FROM public.restaurant_number_sequences
      WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
        AND series = 'KOT' AND last_sequence = 7
    ) THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'QAF1 cleanup appears partially applied; inspect manually before retrying.';
  END IF;

  SELECT count(*) INTO active_orders
  FROM public.restaurant_records
  WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
    AND kind = 'order' AND NOT deleted;

  IF active_orders <> 4 THEN
    RAISE EXCEPTION 'Precondition failed: expected exactly 4 active orders, found %.', active_orders;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.restaurant_records
    WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
      AND kind = 'order' AND NOT deleted AND payload->>'status' = 'settled'
  ) THEN
    RAISE EXCEPTION 'Precondition failed: an active settled bill exists.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.restaurant_records
    WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
      AND kind = 'order' AND NOT deleted
      AND record_id NOT IN (
        '68164a11-1f8e-4afc-9077-6443f437ee3b',
        '3aa725da-4cae-419e-bc74-6dae3738256d',
        'da9c1006-0499-4771-bf8b-a93e46a616f6',
        '3f1d03f2-318b-4ebe-8f18-1c7281dab4b2'
      )
  ) THEN
    RAISE EXCEPTION 'Precondition failed: an unexpected active order exists.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.restaurant_records
    WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
      AND kind = 'order' AND record_id = '68164a11-1f8e-4afc-9077-6443f437ee3b'
      AND NOT deleted AND payload->>'tableId' = 'ROOM-666'
      AND payload->>'billNo' = 'SJT/26-27/0002'
      AND payload->>'status' = 'held' AND payload->'payments' = '[]'::jsonb
  ) OR NOT EXISTS (
    SELECT 1 FROM public.restaurant_records
    WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
      AND kind = 'order' AND record_id = '3aa725da-4cae-419e-bc74-6dae3738256d'
      AND NOT deleted AND payload->>'tableId' = 'ROOM-10A'
      AND payload->>'billNo' = 'SJT/26-27/0003'
      AND payload->>'status' = 'held' AND payload->'payments' = '[]'::jsonb
  ) OR NOT EXISTS (
    SELECT 1 FROM public.restaurant_records
    WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
      AND kind = 'order' AND record_id = 'da9c1006-0499-4771-bf8b-a93e46a616f6'
      AND NOT deleted AND payload->>'tableId' = 'ROOM-7A'
      AND payload->>'billNo' = 'SJT/26-27/0004'
      AND payload->>'status' = 'held' AND payload->'payments' = '[]'::jsonb
  ) THEN
    RAISE EXCEPTION 'Precondition failed: one or more genuine held bills changed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.restaurant_records
    WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
      AND kind = 'order' AND record_id = '3f1d03f2-318b-4ebe-8f18-1c7281dab4b2'
      AND NOT deleted AND payload->>'tableId' = 'QAF1'
      AND payload->>'billNo' = 'D1/26-27/0010'
      AND payload->>'status' = 'held' AND payload->'payments' = '[]'::jsonb
  ) THEN
    RAISE EXCEPTION 'Precondition failed: QAF1 order identity or state changed.';
  END IF;

  SELECT count(*) INTO active_kots
  FROM public.restaurant_records
  WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
    AND kind = 'kot' AND NOT deleted;

  SELECT count(*) INTO qa_kots
  FROM public.restaurant_records
  WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
    AND kind = 'kot' AND NOT deleted
    AND payload->>'orderUid' = '3f1d03f2-318b-4ebe-8f18-1c7281dab4b2';

  SELECT count(*) INTO qa_submissions
  FROM (
    SELECT DISTINCT coalesce(payload->>'submissionId',
      'legacy:' || coalesce(payload->>'orderUid', '') || ':' || coalesce(payload->>'createdAt', '')) AS submission
    FROM public.restaurant_records
    WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
      AND kind = 'kot' AND NOT deleted
      AND payload->>'orderUid' = '3f1d03f2-318b-4ebe-8f18-1c7281dab4b2'
  ) q;

  SELECT count(*) INTO genuine_kots
  FROM public.restaurant_records
  WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
    AND kind = 'kot' AND NOT deleted
    AND payload->>'orderUid' IN (
      '68164a11-1f8e-4afc-9077-6443f437ee3b',
      '3aa725da-4cae-419e-bc74-6dae3738256d',
      'da9c1006-0499-4771-bf8b-a93e46a616f6'
    );

  SELECT count(*) INTO genuine_submissions
  FROM (
    SELECT DISTINCT coalesce(payload->>'submissionId',
      'legacy:' || coalesce(payload->>'orderUid', '') || ':' || coalesce(payload->>'createdAt', '')) AS submission
    FROM public.restaurant_records
    WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
      AND kind = 'kot' AND NOT deleted
      AND payload->>'orderUid' IN (
        '68164a11-1f8e-4afc-9077-6443f437ee3b',
        '3aa725da-4cae-419e-bc74-6dae3738256d',
        'da9c1006-0499-4771-bf8b-a93e46a616f6'
      )
  ) q;

  IF active_kots <> 24 OR qa_kots <> 10 OR qa_submissions <> 4
     OR genuine_kots <> 14 OR genuine_submissions <> 7 THEN
    RAISE EXCEPTION 'Precondition failed: KOT counts changed (active %, QA rows % / groups %, genuine rows % / groups %).',
      active_kots, qa_kots, qa_submissions, genuine_kots, genuine_submissions;
  END IF;

  SELECT count(*) INTO qaf_table_count
  FROM public.restaurant_records
  WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
    AND kind = 'table' AND record_id = 'QAF1' AND NOT deleted
    AND payload->>'status' = 'billed' AND (payload->>'runningTotal')::numeric = 3119;

  IF qaf_table_count <> 1 THEN
    RAISE EXCEPTION 'Precondition failed: QAF1 table state changed.';
  END IF;

  -- Canonicalize the three genuine bills in chronological order.
  UPDATE public.restaurant_records
  SET payload = jsonb_set(payload, '{billNo}', to_jsonb(
    CASE record_id
      WHEN '68164a11-1f8e-4afc-9077-6443f437ee3b' THEN 'POS/0001'
      WHEN '3aa725da-4cae-419e-bc74-6dae3738256d' THEN 'POS/0002'
      WHEN 'da9c1006-0499-4771-bf8b-a93e46a616f6' THEN 'POS/0003'
    END
  ))
  WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
    AND kind = 'order' AND NOT deleted
    AND record_id IN (
      '68164a11-1f8e-4afc-9077-6443f437ee3b',
      '3aa725da-4cae-419e-bc74-6dae3738256d',
      'da9c1006-0499-4771-bf8b-a93e46a616f6'
    );

  -- Each legacy group is one logical submission. All station slips in it
  -- receive one KOT number; submissions are ordered by their first createdAt.
  WITH submissions AS (
    SELECT
      payload->>'orderUid' AS order_uid,
      coalesce(payload->>'submissionId',
        'legacy:' || coalesce(payload->>'orderUid', '') || ':' || coalesce(payload->>'createdAt', '')) AS submission_key,
      min((payload->>'createdAt')::bigint) AS first_created_at
    FROM public.restaurant_records
    WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
      AND kind = 'kot' AND NOT deleted
      AND payload->>'orderUid' IN (
        '68164a11-1f8e-4afc-9077-6443f437ee3b',
        '3aa725da-4cae-419e-bc74-6dae3738256d',
        'da9c1006-0499-4771-bf8b-a93e46a616f6'
      )
    GROUP BY payload->>'orderUid', coalesce(payload->>'submissionId',
      'legacy:' || coalesce(payload->>'orderUid', '') || ':' || coalesce(payload->>'createdAt', ''))
  ), numbered AS (
    SELECT *, row_number() OVER (ORDER BY first_created_at, order_uid, submission_key) AS seq
    FROM submissions
  )
  UPDATE public.restaurant_records r
  SET payload = jsonb_set(
    jsonb_set(r.payload, '{kotNo}', to_jsonb('KOT/' || lpad(n.seq::text, 4, '0'))),
    '{billNo}',
    to_jsonb(CASE n.order_uid
      WHEN '68164a11-1f8e-4afc-9077-6443f437ee3b' THEN 'POS/0001'
      WHEN '3aa725da-4cae-419e-bc74-6dae3738256d' THEN 'POS/0002'
      WHEN 'da9c1006-0499-4771-bf8b-a93e46a616f6' THEN 'POS/0003'
    END)
  )
  FROM numbered n
  WHERE r.restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
    AND r.kind = 'kot' AND NOT r.deleted
    AND r.payload->>'orderUid' = n.order_uid
    AND coalesce(r.payload->>'submissionId',
      'legacy:' || coalesce(r.payload->>'orderUid', '') || ':' || coalesce(r.payload->>'createdAt', '')) = n.submission_key;

  -- Tombstone QAF1 order and all of its kitchen slips; retain payloads for audit.
  UPDATE public.restaurant_records
  SET deleted = true
  WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
    AND kind = 'kot' AND NOT deleted
    AND payload->>'orderUid' = '3f1d03f2-318b-4ebe-8f18-1c7281dab4b2';

  UPDATE public.restaurant_records
  SET deleted = true
  WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
    AND kind = 'order'
    AND record_id = '3f1d03f2-318b-4ebe-8f18-1c7281dab4b2'
    AND NOT deleted;

  UPDATE public.restaurant_records
  SET payload = jsonb_set(
    jsonb_set(
      jsonb_set(payload, '{status}', to_jsonb('free'::text)),
      '{runningTotal}', to_jsonb(0)
    ),
    '{since}', 'null'::jsonb
  )
  WHERE restaurant_id = '66c66ac4-efce-492b-b709-1c2b38d9cd78'
    AND kind = 'table' AND record_id = 'QAF1' AND NOT deleted;

  INSERT INTO public.restaurant_number_sequences (restaurant_id, series, last_sequence)
  VALUES
    ('66c66ac4-efce-492b-b709-1c2b38d9cd78', 'POS', 3),
    ('66c66ac4-efce-492b-b709-1c2b38d9cd78', 'KOT', 7)
  ON CONFLICT (restaurant_id, series)
  DO UPDATE SET last_sequence = EXCLUDED.last_sequence, updated_at = clock_timestamp();
END;
$$;
