CREATE TABLE public.counter_numbering (
 restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
 source_series text NOT NULL,
 series text NOT NULL,
 financial_year text NOT NULL,
 last_sequence integer NOT NULL DEFAULT 0,
 retained_uid text,
 reset_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (restaurant_id, source_series),
 UNIQUE (restaurant_id, series, financial_year)
);
GRANT SELECT ON public.counter_numbering TO authenticated;
GRANT ALL ON public.counter_numbering TO service_role;
ALTER TABLE public.counter_numbering ENABLE ROW LEVEL SECURITY;
CREATE POLICY members_read_numbering ON public.counter_numbering FOR SELECT TO authenticated USING (public.is_member(restaurant_id, auth.uid()));
CREATE OR REPLACE FUNCTION public.reset_counter_bill_numbers(_restaurant uuid, _source text, _year text, _keep text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_series text; wanted text := 'TBX/' || _year || '/0001'; n integer;
BEGIN
 IF NOT public.has_restaurant_role(_restaurant, auth.uid(), ARRAY['owner']::public.restaurant_role[]) THEN RAISE EXCEPTION 'Only the owner can reset bill numbers' USING ERRCODE='42501'; END IF;
 IF _source !~ '^[A-Z0-9]{1,4}$' OR _year !~ '^[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid bill series'; END IF;
 PERFORM 1 FROM public.restaurants WHERE id=_restaurant FOR UPDATE;
 SELECT series INTO old_series FROM public.counter_numbering WHERE restaurant_id=_restaurant AND source_series=_source;
 old_series := coalesce(old_series,_source);
 IF EXISTS (SELECT 1 FROM public.counter_numbering WHERE restaurant_id=_restaurant AND series='TBX' AND financial_year=_year AND source_series<>_source) THEN RAISE EXCEPTION 'TBX is already assigned to another counter'; END IF;
 IF _keep IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.restaurant_records WHERE restaurant_id=_restaurant AND kind='order' AND record_id=_keep AND NOT deleted AND split_part(payload->>'billNo','/',1) IN (_source,old_series,'TBX') AND split_part(payload->>'billNo','/',2)=_year) THEN RAISE EXCEPTION 'Retained bill not found in this counter series'; END IF;
 SELECT count(*) INTO n FROM public.restaurant_records WHERE restaurant_id=_restaurant AND kind='order' AND NOT deleted AND split_part(payload->>'billNo','/',1) IN (_source,old_series,'TBX') AND split_part(payload->>'billNo','/',2)=_year AND (_keep IS NULL OR record_id<>_keep);
 IF n>0 THEN RAISE EXCEPTION 'Reset would reuse existing bill numbers. Keep the existing series.'; END IF;
 INSERT INTO public.counter_numbering(restaurant_id,source_series,series,financial_year,last_sequence,retained_uid) VALUES (_restaurant,_source,'TBX',_year,CASE WHEN _keep IS NULL THEN 0 ELSE 1 END,_keep)
 ON CONFLICT(restaurant_id,source_series) DO UPDATE SET series=excluded.series,financial_year=excluded.financial_year,last_sequence=excluded.last_sequence,retained_uid=excluded.retained_uid,reset_at=clock_timestamp();
 IF _keep IS NOT NULL THEN
 UPDATE public.restaurant_records SET payload=jsonb_set(payload,'{billNo}',to_jsonb(wanted)) WHERE restaurant_id=_restaurant AND NOT deleted AND ((kind='order' AND record_id=_keep) OR (kind='kot' AND payload->>'orderUid'=_keep));
 UPDATE public.guest_orders SET bill_no=wanted WHERE restaurant_id=_restaurant AND order_uid=_keep;
 UPDATE public.cloud_orders SET bill_no=wanted,payload=jsonb_set(payload,'{billNo}',to_jsonb(wanted)) WHERE payload->>'uid'=_keep;
 END IF;
 RETURN jsonb_build_object('series','TBX','lastSequence',CASE WHEN _keep IS NULL THEN 0 ELSE 1 END,'retainedBill',CASE WHEN _keep IS NULL THEN NULL ELSE wanted END);
END $$;
REVOKE ALL ON FUNCTION public.reset_counter_bill_numbers(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reset_counter_bill_numbers(uuid,text,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.canonical_retained_bill_number() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE num text;
BEGIN
 IF NEW.kind IN ('order','kot') AND NOT NEW.deleted THEN
 SELECT series||'/'||financial_year||'/0001' INTO num FROM public.counter_numbering WHERE restaurant_id=NEW.restaurant_id AND retained_uid=CASE WHEN NEW.kind='order' THEN NEW.record_id ELSE NEW.payload->>'orderUid' END;
 IF num IS NOT NULL THEN NEW.payload:=jsonb_set(NEW.payload,'{billNo}',to_jsonb(num)); END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER restaurant_records_canonical_number BEFORE INSERT OR UPDATE ON public.restaurant_records FOR EACH ROW EXECUTE FUNCTION public.canonical_retained_bill_number();