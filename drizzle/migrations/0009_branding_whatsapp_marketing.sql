-- XTSY POS round 7: branded QR ordering and WhatsApp marketing. Run after 0008.
-- Additive and safe to re-run.
--
-- 1. restaurants.branding  — logo, cover photo, colour, tagline, offers, links.
--    Public: the guest ordering page shows it. Owner/manager edit it.
-- 2. restaurants.marketing — WhatsApp sending settings. Private to owner/manager.
-- 3. guest_orders gets WhatsApp consent and where the guest scanned from.
-- 4. qr_scans — how many people opened the menu from each QR code or link, per day.
-- 5. marketing_campaigns / marketing_sends — what was sent, to whom, and how it went.

/* ------------------------------------------------------------ branding */

ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS branding jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS marketing jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Logo and cover are stored as small compressed images inside branding; keep the
-- guest page light on mobile data.
ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_branding_size;
ALTER TABLE public.restaurants ADD CONSTRAINT restaurants_branding_size CHECK (octet_length(branding::text) <= 700000);
ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_marketing_size;
ALTER TABLE public.restaurants ADD CONSTRAINT restaurants_marketing_size CHECK (octet_length(marketing::text) <= 20000);
-- The existing update policy already limits restaurant changes to owners and managers.
GRANT UPDATE (branding, marketing) ON public.restaurants TO authenticated;

/* ----------------------------------------------- guest consent and source */

ALTER TABLE public.guest_orders ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean NOT NULL DEFAULT false;
ALTER TABLE public.guest_orders ADD COLUMN IF NOT EXISTS opt_in_at timestamptz;
ALTER TABLE public.guest_orders ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT '';

-- Called by the guest's phone right after placing an order: records their choice
-- about WhatsApp updates and which QR code or link brought them.
CREATE OR REPLACE FUNCTION public.guest_order_marketing(_id uuid, _token uuid, _opt_in boolean, _source text DEFAULT '')
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE clean text := left(regexp_replace(lower(coalesce(_source, '')), '[^a-z0-9-]', '', 'g'), 24);
BEGIN
  UPDATE guest_orders
     SET whatsapp_opt_in = coalesce(_opt_in, false),
         opt_in_at = CASE WHEN coalesce(_opt_in, false) THEN now() ELSE NULL END,
         source = clean
   WHERE id = _id AND token = _token AND created_at > now() - interval '1 day';
  RETURN FOUND;
END $$;

/* ------------------------------------------------------------ QR scans */

CREATE TABLE IF NOT EXISTS public.qr_scans (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
  day date NOT NULL,
  source text NOT NULL,
  scans integer NOT NULL DEFAULT 0,
  PRIMARY KEY (restaurant_id, day, source)
);
ALTER TABLE public.qr_scans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read scans" ON public.qr_scans;
CREATE POLICY "admins read scans" ON public.qr_scans FOR SELECT TO authenticated
  USING (public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]));

-- Counted once per page open. Source is a short label printed into each QR code
-- (a table id, "poster", "insta", "google"...). Days use India time.
CREATE OR REPLACE FUNCTION public.log_qr_scan(_slug text, _source text DEFAULT '') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid; clean text := left(regexp_replace(lower(coalesce(_source, '')), '[^a-z0-9-]', '', 'g'), 24);
BEGIN
  SELECT id INTO rid FROM restaurants WHERE slug = lower(trim(_slug));
  IF rid IS NULL THEN RETURN; END IF;
  IF clean = '' THEN clean := 'direct'; END IF;
  INSERT INTO qr_scans (restaurant_id, day, source, scans)
  VALUES (rid, (now() AT TIME ZONE 'Asia/Kolkata')::date, clean, 1)
  ON CONFLICT (restaurant_id, day, source) DO UPDATE SET scans = qr_scans.scans + 1;
END $$;

/* ---------------------------------------------------- campaigns and sends */

CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  message text NOT NULL DEFAULT '' CHECK (length(message) <= 1000),
  audience text NOT NULL DEFAULT 'all',
  mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'auto')),
  template text NOT NULL DEFAULT '',
  recipients integer NOT NULL DEFAULT 0,
  sent integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS marketing_campaigns_recent ON public.marketing_campaigns (restaurant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.marketing_sends (
  campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns (id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
  phone text NOT NULL CHECK (phone ~ '^[0-9]{10,15}$'),
  name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'skipped', 'failed')),
  error text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, phone)
);
CREATE INDEX IF NOT EXISTS marketing_sends_phone ON public.marketing_sends (restaurant_id, phone, at DESC);

ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage campaigns" ON public.marketing_campaigns;
DROP POLICY IF EXISTS "admins manage sends" ON public.marketing_sends;
CREATE POLICY "admins manage campaigns" ON public.marketing_campaigns FOR ALL TO authenticated
  USING (public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]))
  WITH CHECK (public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]));
CREATE POLICY "admins manage sends" ON public.marketing_sends FOR ALL TO authenticated
  USING (public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]))
  WITH CHECK (public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_campaigns, public.marketing_sends TO authenticated;
GRANT SELECT ON public.qr_scans TO authenticated;

-- Keep a campaign's counts in step with its sends.
CREATE OR REPLACE FUNCTION public.count_campaign_sends() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid := coalesce(NEW.campaign_id, OLD.campaign_id);
BEGIN
  UPDATE marketing_campaigns c SET
    sent = (SELECT count(*) FROM marketing_sends s WHERE s.campaign_id = cid AND s.status = 'sent'),
    failed = (SELECT count(*) FROM marketing_sends s WHERE s.campaign_id = cid AND s.status = 'failed')
  WHERE c.id = cid;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS marketing_sends_count ON public.marketing_sends;
CREATE TRIGGER marketing_sends_count AFTER INSERT OR UPDATE OR DELETE ON public.marketing_sends
  FOR EACH ROW EXECUTE FUNCTION public.count_campaign_sends();

/* ------------------------------------------- storefront now carries branding */

CREATE OR REPLACE FUNCTION public.public_storefront(_slug text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE rr restaurants; s jsonb; qr boolean; web boolean; menu jsonb; tbls jsonb;
BEGIN
  SELECT * INTO rr FROM restaurants WHERE slug = lower(trim(_slug));
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT payload INTO s FROM restaurant_records WHERE restaurant_id = rr.id AND kind = 'settings' AND NOT deleted LIMIT 1;
  s := coalesce(s, '{}'::jsonb);
  qr := coalesce((rr.ordering ->> 'table')::boolean, false) AND account_feature(rr.account_id, 'qr_ordering');
  web := coalesce((rr.ordering ->> 'online')::boolean, false) AND account_feature(rr.account_id, 'online_ordering');
  IF qr OR web THEN
    SELECT coalesce(jsonb_agg(
      (m.payload - 'recipe' - 'stockTracked' - 'prices') || jsonb_build_object(
        'takeawayPrice', m.payload #> '{prices,takeaway}',
        'variants', (SELECT coalesce(jsonb_agg(v - 'recipe'), '[]'::jsonb) FROM jsonb_array_elements(coalesce(m.payload -> 'variants', '[]'::jsonb)) v),
        'addons', (SELECT coalesce(jsonb_agg(a - 'recipe'), '[]'::jsonb) FROM jsonb_array_elements(coalesce(m.payload -> 'addons', '[]'::jsonb)) a))
      ORDER BY m.payload ->> 'category', m.payload ->> 'name'), '[]'::jsonb)
    INTO menu
    FROM restaurant_records m
    WHERE m.restaurant_id = rr.id AND m.kind = 'menu' AND NOT m.deleted AND coalesce((m.payload ->> 'available')::boolean, true);
  END IF;
  IF qr THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.record_id, 'label', t.payload ->> 'label', 'section', t.payload ->> 'section') ORDER BY t.payload ->> 'section', t.payload ->> 'label'), '[]'::jsonb)
    INTO tbls FROM restaurant_records t WHERE t.restaurant_id = rr.id AND t.kind = 'table' AND NOT t.deleted;
  END IF;
  RETURN jsonb_build_object(
    'id', rr.id, 'slug', rr.slug,
    'name', coalesce(nullif(s ->> 'name', ''), rr.name),
    'address', coalesce(s ->> 'address', ''), 'phone', coalesce(s ->> 'phone', ''), 'fssai', coalesce(s ->> 'fssai', ''),
    'upiVpa', CASE WHEN coalesce((rr.ordering ->> 'upi')::boolean, false) THEN coalesce(s ->> 'upiVpa', '') ELSE '' END,
    'gstMode', coalesce(s ->> 'gstMode', 'regular'), 'pricesIncludeGst', coalesce((s ->> 'pricesIncludeGst')::boolean, false),
    'categoryOrder', coalesce(s -> 'categoryOrder', '[]'::jsonb),
    'qr', qr, 'online', web, 'paused', coalesce((rr.ordering ->> 'paused')::boolean, false),
    'prepMinutes', coalesce((rr.ordering ->> 'prepMinutes')::integer, 20),
    'minOrder', coalesce((rr.ordering ->> 'minOrder')::numeric, 0),
    'message', coalesce(rr.ordering ->> 'message', ''),
    'live', account_is_live(rr.account_id),
    'branding', coalesce(rr.branding, '{}'::jsonb),
    'menu', coalesce(menu, '[]'::jsonb), 'tables', coalesce(tbls, '[]'::jsonb));
END $$;

REVOKE EXECUTE ON FUNCTION public.guest_order_marketing(uuid, uuid, boolean, text), public.log_qr_scan(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.guest_order_marketing(uuid, uuid, boolean, text), public.log_qr_scan(text, text) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.count_campaign_sends() FROM public, anon, authenticated;
