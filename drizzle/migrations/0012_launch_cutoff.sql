-- Launch cut-off: once a restaurant has launched, bills, kitchen tickets, stock
-- movements and day closes made before that moment are refused. A device that
-- held offline test bills from before launch would otherwise upload them later
-- (this happened on 25 Oct) and mix them into the real books. The refusal uses
-- SQLSTATE 42501, which devices already treat as "the cloud said no": they drop
-- the record, remove their local copy and keep syncing everything else.

ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS launched_at timestamptz;

CREATE OR REPLACE FUNCTION public.reject_prelaunch_records()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cutoff timestamptz;
  made bigint;
BEGIN
  IF NEW.deleted OR NEW.kind NOT IN ('order', 'kot', 'stock_entry', 'day_close') THEN
    RETURN NEW;
  END IF;
  SELECT launched_at INTO cutoff FROM public.restaurants WHERE id = NEW.restaurant_id;
  IF cutoff IS NULL THEN
    RETURN NEW;
  END IF;
  made := COALESCE(
    CASE WHEN NEW.payload->>'createdAt' ~ '^[0-9]+$' THEN (NEW.payload->>'createdAt')::bigint END,
    CASE WHEN NEW.payload->>'at' ~ '^[0-9]+$' THEN (NEW.payload->>'at')::bigint END
  );
  IF made IS NOT NULL AND to_timestamp(made / 1000.0) < cutoff THEN
    RAISE EXCEPTION 'Made before launch: % % is a pre-launch record and is not kept.', NEW.kind, NEW.record_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restaurant_records_launch_cutoff ON public.restaurant_records;
CREATE TRIGGER restaurant_records_launch_cutoff
  BEFORE INSERT OR UPDATE ON public.restaurant_records
  FOR EACH ROW EXECUTE FUNCTION public.reject_prelaunch_records();
