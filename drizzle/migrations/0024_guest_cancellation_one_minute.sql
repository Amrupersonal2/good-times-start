CREATE OR REPLACE FUNCTION public.guest_order_update(_id uuid, _token uuid, _cancel boolean DEFAULT false, _upi_ref text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g public.guest_orders;
BEGIN
  SELECT * INTO g FROM public.guest_orders WHERE id = _id AND token = _token FOR UPDATE;
  IF g.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _cancel THEN
    IF g.status = 'cancelled' AND g.reason = 'Cancelled by guest' THEN RETURN 'cancelled'; END IF;
    IF clock_timestamp() > g.created_at + interval '1 minute' THEN RAISE EXCEPTION 'The one-minute cancellation window has ended. Please contact the restaurant.'; END IF;
    IF g.status <> 'new' THEN RAISE EXCEPTION 'The kitchen has already accepted this order. Please ask the staff.'; END IF;
    UPDATE public.guest_orders SET status = 'cancelled', reason = 'Cancelled by guest' WHERE id = g.id;
    RETURN 'cancelled';
  END IF;
  IF _upi_ref IS NOT NULL THEN
    IF g.status IN ('cancelled','rejected','completed') THEN RAISE EXCEPTION 'This order is closed'; END IF;
    UPDATE public.guest_orders SET upi_ref = left(regexp_replace(_upi_ref, '[^A-Za-z0-9]', '', 'g'), 40), payment = 'upi' WHERE id = g.id;
  END IF;
  RETURN g.status;
END $$;
REVOKE ALL ON FUNCTION public.guest_order_update(uuid,uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_order_update(uuid,uuid,boolean,text) TO anon, authenticated, service_role;
ALTER POLICY "staff handle guest orders" ON public.guest_orders TO authenticated
USING (public.has_restaurant_role(restaurant_id,auth.uid(),ARRAY['owner','manager','cashier','captain']::public.restaurant_role[]))
WITH CHECK (public.has_restaurant_role(restaurant_id,auth.uid(),ARRAY['owner','manager','cashier','captain']::public.restaurant_role[]));