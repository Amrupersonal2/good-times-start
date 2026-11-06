-- Safe numbering bootstrap for every restaurant.
-- Preserve all existing bills, KOTs, tables and historical/test records.
-- Seed allocators above the highest existing numeric suffix / logical KOT submission.
DO $$
BEGIN
  IF to_regclass('public.restaurant_number_sequences') IS NULL
     OR to_regclass('public.restaurant_records') IS NULL THEN
    RAISE EXCEPTION 'Run migration 0016 before numbering bootstrap 0017.';
  END IF;
END;
$$;

INSERT INTO public.restaurant_number_sequences (restaurant_id, series, last_sequence)
SELECT restaurant_id, 'POS',
       coalesce(max((regexp_match(payload->>'billNo', '([0-9]+)$'))[1]::bigint), 0)
FROM public.restaurant_records
WHERE kind = 'order' AND NOT deleted
  AND coalesce(payload->>'billNo', '') ~ '[0-9]+$'
GROUP BY restaurant_id
ON CONFLICT (restaurant_id, series)
DO UPDATE SET
  last_sequence = greatest(public.restaurant_number_sequences.last_sequence, EXCLUDED.last_sequence),
  updated_at = clock_timestamp();

WITH kot_counts AS (
  SELECT restaurant_id,
         greatest(
           coalesce(max((regexp_match(payload->>'kotNo', '([0-9]+)$'))[1]::bigint), 0),
           count(DISTINCT coalesce(payload->>'submissionId',
             'legacy:' || coalesce(payload->>'orderUid', '') || ':' || coalesce(payload->>'createdAt', '')))
         ) AS last_sequence
  FROM public.restaurant_records
  WHERE kind = 'kot' AND NOT deleted
  GROUP BY restaurant_id
)
INSERT INTO public.restaurant_number_sequences (restaurant_id, series, last_sequence)
SELECT restaurant_id, 'KOT', last_sequence FROM kot_counts
ON CONFLICT (restaurant_id, series)
DO UPDATE SET
  last_sequence = greatest(public.restaurant_number_sequences.last_sequence, EXCLUDED.last_sequence),
  updated_at = clock_timestamp();

-- Intentionally no one-time QAF1 deletion or hard-coded row-count assertions.
-- The previously observed live data changed after the original snapshot; QAF1
-- and every active record remain intact for a separately reconciled operation.
