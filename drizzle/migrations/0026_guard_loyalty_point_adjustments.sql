CREATE OR REPLACE FUNCTION public.guard_customer_points_adjustment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old jsonb;
  _new jsonb;
BEGIN
  IF NEW.kind <> 'customer' OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.has_restaurant_role(NEW.restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]) THEN
    RETURN NEW;
  END IF;
  _new := NEW.payload -> 'pointsAdjustment';
  IF TG_OP = 'UPDATE' THEN _old := OLD.payload -> 'pointsAdjustment'; ELSE _old := NULL; END IF;
  IF _new IS DISTINCT FROM _old THEN
    IF _old IS NULL THEN
      NEW.payload := NEW.payload - 'pointsAdjustment';
    ELSE
      NEW.payload := jsonb_set(NEW.payload, '{pointsAdjustment}', _old);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_customer_points_adjustment ON public.restaurant_records;
CREATE TRIGGER guard_customer_points_adjustment
BEFORE INSERT OR UPDATE ON public.restaurant_records
FOR EACH ROW EXECUTE FUNCTION public.guard_customer_points_adjustment();

REVOKE EXECUTE ON FUNCTION public.guard_customer_points_adjustment() FROM PUBLIC, anon, authenticated;