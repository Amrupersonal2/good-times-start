CREATE TABLE public.guest_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
 request_id uuid NOT NULL,
 token uuid NOT NULL DEFAULT gen_random_uuid(),
 table_id text NOT NULL, table_label text NOT NULL, section text NOT NULL DEFAULT '',
 guest_name text NOT NULL, guest_phone text NOT NULL, party_size integer NOT NULL,
 arrival_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','arrived','cancelled','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(restaurant_id, request_id)
);
GRANT SELECT ON public.guest_reservations TO authenticated;
GRANT ALL ON public.guest_reservations TO service_role;
ALTER TABLE public.guest_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY reservation_staff_read ON public.guest_reservations FOR SELECT TO authenticated USING (public.is_member(restaurant_id, auth.uid()));
CREATE INDEX guest_reservation_slot ON public.guest_reservations(restaurant_id, table_id, arrival_at, end_at) WHERE status IN ('pending','confirmed','arrived');

CREATE FUNCTION public.public_booking_availability(_slug text, _arrival timestamptz, _hours integer DEFAULT 2) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.restaurants; enabled boolean; places jsonb;
BEGIN
 SELECT * INTO r FROM public.restaurants WHERE slug=_slug;
 IF r.id IS NULL THEN RETURN NULL; END IF;
 enabled := public.account_is_live(r.account_id) AND COALESCE((r.ordering->>'table')::boolean,false) AND public.account_feature(r.account_id,'qr_ordering');
 IF _arrival IS NULL OR _hours NOT BETWEEN 1 AND 24 THEN RAISE EXCEPTION 'Choose a valid arrival and duration'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',t.record_id,'label',t.payload->>'label','section',COALESCE(t.payload->>'section',''),'seats',COALESCE((t.payload->>'seats')::integer,4),'occupancy',
 CASE WHEN EXISTS(SELECT 1 FROM public.restaurant_records b WHERE b.restaurant_id=r.id AND b.kind='order' AND NOT b.deleted AND b.payload->>'status'='held' AND b.payload->>'tableId'=t.record_id AND jsonb_array_length(COALESCE(b.payload->'lines','[]'::jsonb))>0) THEN 'occupied'
 WHEN EXISTS(SELECT 1 FROM public.guest_reservations g WHERE g.restaurant_id=r.id AND g.table_id=t.record_id AND g.status IN ('pending','confirmed','arrived') AND g.arrival_at < _arrival + make_interval(hours=>_hours) AND g.end_at > _arrival) OR t.payload->>'status'='reserved' OR (t.payload->>'heldDevice' IS NOT NULL AND COALESCE((t.payload->>'heldAt')::bigint,0)>extract(epoch FROM now()-interval '10 minutes')*1000) THEN 'reserved'
 WHEN t.payload->>'status' IN ('occupied','billed') AND NOT EXISTS(SELECT 1 FROM public.restaurant_records b WHERE b.restaurant_id=r.id AND b.kind='order' AND NOT b.deleted AND b.payload->>'tableId'=t.record_id AND b.payload->>'status' IN ('settled','void')) THEN 'occupied'
 ELSE 'free' END) ORDER BY t.payload->>'section',t.payload->>'label'),'[]'::jsonb) INTO places FROM public.restaurant_records t WHERE t.restaurant_id=r.id AND t.kind='table' AND NOT t.deleted;
 RETURN jsonb_build_object('name',r.name,'slug',r.slug,'enabled',enabled,'places',CASE WHEN enabled THEN places ELSE '[]'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION public.public_booking_availability(text,timestamptz,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_availability(text,timestamptz,integer) TO anon,authenticated,service_role;

CREATE FUNCTION public.request_guest_reservation(_slug text,_request uuid,_table text,_name text,_phone text,_party integer,_arrival timestamptz,_hours integer DEFAULT 2) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.restaurants; g public.guest_reservations; p jsonb; availability jsonb;
BEGIN
 SELECT * INTO r FROM public.restaurants WHERE slug=_slug;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.id::text,0));
 SELECT * INTO g FROM public.guest_reservations WHERE restaurant_id=r.id AND request_id=_request;
 IF g.id IS NOT NULL THEN
  IF g.guest_phone <> regexp_replace(_phone,'[^0-9]','','g') OR g.table_id<>_table OR g.arrival_at<>_arrival THEN RAISE EXCEPTION 'Request identity mismatch'; END IF;
  RETURN jsonb_build_object('id',g.id,'token',g.token,'status',g.status);
 END IF;
 IF _arrival IS NULL OR _arrival<=now() OR _arrival>now()+interval '90 days' OR _hours NOT BETWEEN 1 AND 24 THEN RAISE EXCEPTION 'Choose a future arrival within 90 days and duration of 1 to 24 hours'; END IF;
 IF length(trim(_name)) NOT BETWEEN 2 AND 80 OR regexp_replace(_phone,'[^0-9]','','g') !~ '^[0-9]{10,15}$' THEN RAISE EXCEPTION 'Enter a guest name and valid mobile number'; END IF;
 availability := public.public_booking_availability(_slug,_arrival,_hours);
 IF NOT COALESCE((availability->>'enabled')::boolean,false) THEN RAISE EXCEPTION 'Guest reservations are off'; END IF;
 SELECT value INTO p FROM jsonb_array_elements(availability->'places') WHERE value->>'id'=_table;
 IF p IS NULL OR p->>'occupancy'<>'free' THEN RAISE EXCEPTION 'This place is no longer available. Choose another.'; END IF;
 IF _party IS NULL OR _party<1 OR _party>(p->>'seats')::integer THEN RAISE EXCEPTION 'Guest count exceeds capacity'; END IF;
 INSERT INTO public.guest_reservations(restaurant_id,request_id,table_id,table_label,section,guest_name,guest_phone,party_size,arrival_at,end_at)
 VALUES(r.id,_request,_table,p->>'label',p->>'section',trim(_name),regexp_replace(_phone,'[^0-9]','','g'),_party,_arrival,_arrival+make_interval(hours=>_hours)) RETURNING * INTO g;
 RETURN jsonb_build_object('id',g.id,'token',g.token,'status',g.status);
END $$;
REVOKE ALL ON FUNCTION public.request_guest_reservation(text,uuid,text,text,text,integer,timestamptz,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_guest_reservation(text,uuid,text,text,text,integer,timestamptz,integer) TO anon,authenticated,service_role;

CREATE FUNCTION public.guest_reservation_status(_id uuid,_token uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('id',id,'table_label',table_label,'section',section,'party_size',party_size,'arrival_at',arrival_at,'end_at',end_at,'status',status) FROM public.guest_reservations WHERE id=_id AND token=_token
$$;
REVOKE ALL ON FUNCTION public.guest_reservation_status(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_reservation_status(uuid,uuid) TO anon,authenticated,service_role;

CREATE FUNCTION public.manage_guest_reservation(_id uuid,_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g public.guest_reservations;
BEGIN
 SELECT * INTO g FROM public.guest_reservations WHERE id=_id;
 IF g.id IS NULL OR NOT public.has_restaurant_role(g.restaurant_id,auth.uid(),ARRAY['owner','manager','cashier','captain']::public.restaurant_role[]) THEN RAISE EXCEPTION 'Not permitted'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(g.restaurant_id::text,0));
 SELECT * INTO g FROM public.guest_reservations WHERE id=_id FOR UPDATE;
 IF NOT ((_status IN ('confirmed','rejected') AND g.status='pending') OR (_status='arrived' AND g.status='confirmed') OR (_status='cancelled' AND g.status IN ('pending','confirmed','arrived'))) THEN RAISE EXCEPTION 'Reservation has changed. Refresh before continuing.'; END IF;
 IF _status IN ('confirmed','arrived') AND g.end_at<=now() THEN RAISE EXCEPTION 'This arrival slot has ended'; END IF;
 IF _status IN ('confirmed','arrived') AND EXISTS(SELECT 1 FROM public.guest_reservations x WHERE x.restaurant_id=g.restaurant_id AND x.table_id=g.table_id AND x.id<>g.id AND x.status IN ('pending','confirmed','arrived') AND x.arrival_at<g.end_at AND x.end_at>g.arrival_at) THEN RAISE EXCEPTION 'Another reservation overlaps this slot'; END IF;
 UPDATE public.guest_reservations SET status=_status,updated_at=now() WHERE id=_id;
END $$;
REVOKE ALL ON FUNCTION public.manage_guest_reservation(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_guest_reservation(uuid,text) TO authenticated,service_role;