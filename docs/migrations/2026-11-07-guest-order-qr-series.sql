-- Guest QR orders get their own series, QR/0001, QR/0002 …, assigned by the server when the
-- guest places the order. The POS number is still given only at settlement or first print.
-- Orders placed before this series (pre-launch tests) keep qr_no NULL.
ALTER TABLE public.guest_orders ADD COLUMN IF NOT EXISTS qr_no bigint;
CREATE UNIQUE INDEX IF NOT EXISTS guest_orders_restaurant_qr_no ON public.guest_orders (restaurant_id, qr_no) WHERE qr_no IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_guest_order_qr_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.restaurant_id::text || ':guest-qr-series', 0));
  SELECT coalesce(max(qr_no), 0) + 1 INTO NEW.qr_no FROM public.guest_orders WHERE restaurant_id = NEW.restaurant_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guest_orders_qr_no ON public.guest_orders;
CREATE TRIGGER guest_orders_qr_no BEFORE INSERT ON public.guest_orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_guest_order_qr_no();
