CREATE TABLE public.counter_print_routes (
 restaurant_id uuid PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
 device_id text NOT NULL,
 configured_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.counter_print_routes TO authenticated;
GRANT ALL ON public.counter_print_routes TO service_role;
ALTER TABLE public.counter_print_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_read_print_route ON public.counter_print_routes FOR SELECT TO authenticated USING (public.is_member(restaurant_id, auth.uid()));
CREATE TABLE public.counter_print_jobs (
 id uuid PRIMARY KEY,
 restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
 requested_by uuid NOT NULL,
 target_device text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('bill','kot')),
 payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','dispatched')),
 created_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz,
 dispatched_at timestamptz
);
GRANT SELECT ON public.counter_print_jobs TO authenticated;
GRANT ALL ON public.counter_print_jobs TO service_role;
ALTER TABLE public.counter_print_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_print_job_status ON public.counter_print_jobs FOR SELECT TO authenticated USING (requested_by = auth.uid() AND public.is_member(restaurant_id, auth.uid()));
CREATE INDEX counter_print_pending ON public.counter_print_jobs(restaurant_id,target_device,created_at) WHERE status='pending';
CREATE FUNCTION public.configure_counter_printer(_restaurant uuid, _device text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.has_restaurant_role(_restaurant,auth.uid(),ARRAY['owner','manager','cashier']::public.restaurant_role[]) THEN RAISE EXCEPTION 'Counter access required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.terminals WHERE restaurant_id=_restaurant AND device_id=_device AND user_id=auth.uid() AND app='pos' AND status='active') THEN RAISE EXCEPTION 'Open the connected POS device first'; END IF;
 INSERT INTO public.counter_print_routes(restaurant_id,device_id,configured_by) VALUES(_restaurant,_device,auth.uid()) ON CONFLICT(restaurant_id) DO UPDATE SET device_id=excluded.device_id,configured_by=excluded.configured_by,updated_at=now();
END $$;
CREATE FUNCTION public.enqueue_counter_print(_id uuid,_restaurant uuid,_kind text,_payload jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target text;
BEGIN
 IF NOT public.has_restaurant_role(_restaurant,auth.uid(),ARRAY['owner','manager','cashier','captain']::public.restaurant_role[]) THEN RAISE EXCEPTION 'Order printing access required'; END IF;
 IF _kind NOT IN ('bill','kot') OR octet_length(_payload::text)>100000 OR jsonb_typeof(_payload) NOT IN ('object','array') THEN RAISE EXCEPTION 'Invalid print request'; END IF;
 SELECT device_id INTO target FROM public.counter_print_routes WHERE restaurant_id=_restaurant;
 IF target IS NULL THEN RAISE EXCEPTION 'No connected counter printer has been designated'; END IF;
 IF (SELECT count(*) FROM public.counter_print_jobs WHERE requested_by=auth.uid() AND created_at>now()-interval '1 minute')>=60 THEN RAISE EXCEPTION 'Too many print requests'; END IF;
 INSERT INTO public.counter_print_jobs(id,restaurant_id,requested_by,target_device,kind,payload) VALUES(_id,_restaurant,auth.uid(),target,_kind,_payload) ON CONFLICT(id) DO NOTHING;
END $$;
CREATE FUNCTION public.claim_counter_print(_restaurant uuid,_device text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.counter_print_jobs;
BEGIN
 IF NOT public.has_restaurant_role(_restaurant,auth.uid(),ARRAY['owner','manager','cashier']::public.restaurant_role[]) OR NOT EXISTS(SELECT 1 FROM public.terminals WHERE restaurant_id=_restaurant AND device_id=_device AND user_id=auth.uid() AND app='pos' AND status='active') THEN RETURN NULL; END IF;
 SELECT * INTO job FROM public.counter_print_jobs WHERE restaurant_id=_restaurant AND target_device=_device AND status='pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF job.id IS NULL THEN RETURN NULL; END IF;
 UPDATE public.counter_print_jobs SET status='claimed',claimed_at=now() WHERE id=job.id;
 RETURN jsonb_build_object('id',job.id,'kind',job.kind,'payload',job.payload);
END $$;
CREATE FUNCTION public.finish_counter_print(_id uuid,_device text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.counter_print_jobs j SET status='dispatched',dispatched_at=now() WHERE j.id=_id AND j.target_device=_device AND j.status='claimed' AND public.has_restaurant_role(j.restaurant_id,auth.uid(),ARRAY['owner','manager','cashier']::public.restaurant_role[]) AND EXISTS(SELECT 1 FROM public.terminals t WHERE t.restaurant_id=j.restaurant_id AND t.device_id=_device AND t.user_id=auth.uid() AND t.app='pos' AND t.status='active');
END $$;
REVOKE ALL ON FUNCTION public.configure_counter_printer(uuid,text),public.enqueue_counter_print(uuid,uuid,text,jsonb),public.claim_counter_print(uuid,text),public.finish_counter_print(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_counter_printer(uuid,text),public.enqueue_counter_print(uuid,uuid,text,jsonb),public.claim_counter_print(uuid,text),public.finish_counter_print(uuid,text) TO authenticated;