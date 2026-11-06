-- XTSY POS round 3: SaaS accounts and plans, multiple outlets, QR table ordering
-- and online ordering. Additive and idempotent: safe to run more than once, and
-- existing restaurants keep working (they become complimentary accounts).

/* ------------------------------------------------------------------ plans */

CREATE TABLE IF NOT EXISTS public.plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  -- Rupees per outlet, before GST.
  monthly_price integer NOT NULL DEFAULT 0,
  yearly_price integer NOT NULL DEFAULT 0,
  max_outlets integer NOT NULL DEFAULT 1,
  max_staff integer NOT NULL DEFAULT 5,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

INSERT INTO public.plans (id, name, monthly_price, yearly_price, max_outlets, max_staff, features, sort) VALUES
  ('trial',   'Free trial', 0,    0,     1,  10,  '{"qr_ordering":true,"online_ordering":true,"multi_outlet":false,"insights":true}', 0),
  ('starter', 'Starter',    799,  7999,  1,  5,   '{"qr_ordering":false,"online_ordering":false,"multi_outlet":false,"insights":true}', 1),
  ('growth',  'Growth',     1499, 14999, 1,  15,  '{"qr_ordering":true,"online_ordering":true,"multi_outlet":false,"insights":true}', 2),
  ('chain',   'Chain',      3999, 39999, 5,  100, '{"qr_ordering":true,"online_ordering":true,"multi_outlet":true,"insights":true}', 3)
ON CONFLICT (id) DO NOTHING;

/* --------------------------------------------------------------- accounts */

-- The business that subscribes. One account owns one or more outlets (restaurants).
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid,
  plan_id text NOT NULL DEFAULT 'trial' REFERENCES public.plans(id),
  status text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','suspended','cancelled')),
  trial_ends_at timestamptz DEFAULT (now() + interval '14 days'),
  paid_until timestamptz,
  billing_email text NOT NULL DEFAULT '',
  billing_phone text NOT NULL DEFAULT '',
  billing_gstin text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.account_events (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  amount numeric,
  by_user uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_events_account ON public.account_events (account_id, created_at DESC);

-- People who run XTSY POS itself (see every account, change plans).
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

/* ------------------------------------------------- outlets (restaurants) */

ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '';
-- {table, online, paused, upi, prepMinutes, minOrder, message}
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS ordering jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS restaurants_slug ON public.restaurants (slug);
CREATE INDEX IF NOT EXISTS restaurants_account ON public.restaurants (account_id);
DO $$ BEGIN
  ALTER TABLE public.restaurants ADD CONSTRAINT restaurants_slug_format CHECK (slug IS NULL OR slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Owners and managers may change only these columns; plan and account links change through functions.
REVOKE UPDATE ON public.restaurants FROM authenticated;
GRANT UPDATE (name, slug, city, ordering) ON public.restaurants TO authenticated;

/* ---------------------------------------------------------------- helpers */

CREATE OR REPLACE FUNCTION public.slugify(_text text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(nullif(left(trim(both '-' from regexp_replace(lower(coalesce(_text,'')), '[^a-z0-9]+', '-', 'g')), 32), ''), 'restaurant')
$$;

CREATE OR REPLACE FUNCTION public.unique_slug(_text text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE base text := trim(both '-' from slugify(_text)); candidate text; n integer := 1;
BEGIN
  IF base = '' THEN base := 'restaurant'; END IF;
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM restaurants WHERE slug = candidate) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;
  RETURN candidate;
END $$;

CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()) $$;

-- Owner of the account, or owner of any of its outlets.
CREATE OR REPLACE FUNCTION public.is_account_owner(_account uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM accounts WHERE id = _account AND owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM restaurants r JOIN restaurant_members m ON m.restaurant_id = r.id
                 WHERE r.account_id = _account AND m.user_id = auth.uid() AND m.role = 'owner')
$$;

CREATE OR REPLACE FUNCTION public.is_account_member(_account uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM restaurants r JOIN restaurant_members m ON m.restaurant_id = r.id
                 WHERE r.account_id = _account AND m.user_id = auth.uid())
$$;

-- An account is live while its trial runs, while paid (plus 7 days' grace), or when complimentary.
CREATE OR REPLACE FUNCTION public.account_is_live(_account uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
    SELECT CASE a.status
      WHEN 'trialing' THEN a.trial_ends_at IS NULL OR a.trial_ends_at > now()
      WHEN 'active' THEN a.paid_until IS NULL OR a.paid_until + interval '7 days' > now()
      WHEN 'past_due' THEN a.paid_until IS NULL OR a.paid_until + interval '7 days' > now()
      ELSE false END
    FROM accounts a WHERE a.id = _account), true)  -- outlets with no account (older data) stay live
$$;

CREATE OR REPLACE FUNCTION public.account_feature(_account uuid, _feature text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _account IS NULL THEN true
    ELSE account_is_live(_account) AND coalesce((SELECT (p.features ->> _feature)::boolean FROM accounts a JOIN plans p ON p.id = a.plan_id WHERE a.id = _account), false) END
$$;

/* --------------------------------------------- backfill existing outlets */

DO $$
DECLARE r record; aid uuid;
BEGIN
  FOR r IN SELECT id, name, created_by FROM public.restaurants WHERE account_id IS NULL ORDER BY created_at LOOP
    INSERT INTO public.accounts (name, owner_id, plan_id, status, trial_ends_at, notes)
    VALUES (r.name,
            coalesce(r.created_by, (SELECT user_id FROM public.restaurant_members WHERE restaurant_id = r.id AND role = 'owner' ORDER BY created_at LIMIT 1)),
            'chain', 'active', NULL, 'Restaurant created before plans existed: complimentary.')
    RETURNING id INTO aid;
    UPDATE public.restaurants SET account_id = aid WHERE id = r.id;
  END LOOP;
  FOR r IN SELECT id, name FROM public.restaurants WHERE slug IS NULL ORDER BY created_at LOOP
    UPDATE public.restaurants SET slug = public.unique_slug(r.name) WHERE id = r.id;
  END LOOP;
  -- The first restaurant's creator runs the platform until other admins are added.
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins) THEN
    INSERT INTO public.platform_admins (user_id)
    SELECT created_by FROM public.restaurants WHERE created_by IS NOT NULL ORDER BY created_at LIMIT 1
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

/* ----------------------------------------------------- access and grants */

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.plans TO anon, authenticated;
GRANT SELECT ON public.accounts, public.account_events, public.platform_admins TO authenticated;
GRANT ALL ON public.plans, public.accounts, public.account_events, public.platform_admins TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.account_events_id_seq TO service_role;

DROP POLICY IF EXISTS "anyone reads plans" ON public.plans;
DROP POLICY IF EXISTS "members read account" ON public.accounts;
DROP POLICY IF EXISTS "owners read account events" ON public.account_events;
DROP POLICY IF EXISTS "admins see themselves" ON public.platform_admins;
CREATE POLICY "anyone reads plans" ON public.plans FOR SELECT TO anon, authenticated USING (active OR public.is_platform_admin());
CREATE POLICY "members read account" ON public.accounts FOR SELECT TO authenticated USING (public.is_account_member(id) OR public.is_platform_admin());
CREATE POLICY "owners read account events" ON public.account_events FOR SELECT TO authenticated USING (public.is_account_owner(account_id) OR public.is_platform_admin());
CREATE POLICY "admins see themselves" ON public.platform_admins FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Only owners and managers change restaurant details (settings). Earlier policies let any member overwrite them.
DROP POLICY IF EXISTS "members write records" ON public.restaurant_records;
DROP POLICY IF EXISTS "members update records" ON public.restaurant_records;
DROP POLICY IF EXISTS "Members can add shared records" ON public.restaurant_records;
DROP POLICY IF EXISTS "Members can update shared records" ON public.restaurant_records;
CREATE POLICY "members write records" ON public.restaurant_records FOR INSERT TO authenticated
  WITH CHECK (public.is_member(restaurant_id, auth.uid())
    AND (kind <> 'settings' OR public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[])));
CREATE POLICY "members update records" ON public.restaurant_records FOR UPDATE TO authenticated
  USING (public.is_member(restaurant_id, auth.uid()))
  WITH CHECK (public.is_member(restaurant_id, auth.uid())
    AND (kind <> 'settings' OR public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[])));

/* -------------------------------------------- sign-up and outlet actions */

-- A new sign-up gets a 14-day trial account with its first outlet.
CREATE OR REPLACE FUNCTION public.create_restaurant(_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid; aid uuid; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF length(trim(coalesce(_name,''))) = 0 THEN RAISE EXCEPTION 'Restaurant name is required'; END IF;
  INSERT INTO accounts (name, owner_id) VALUES (trim(_name), uid) RETURNING id INTO aid;
  INSERT INTO restaurants (name, created_by, account_id, slug) VALUES (trim(_name), uid, aid, unique_slug(_name)) RETURNING id INTO rid;
  INSERT INTO restaurant_members (restaurant_id, user_id, role, display_name, email)
  SELECT rid, uid, 'owner', coalesce((SELECT display_name FROM profiles WHERE id = uid), ''), coalesce((SELECT email FROM auth.users WHERE id = uid), '');
  INSERT INTO account_events (account_id, kind, detail, by_user) VALUES (aid, 'signup', jsonb_build_object('outlet', rid), uid);
  RETURN rid;
END $$;

-- Add another outlet to an account; optionally start it with another outlet's menu, stock items, suppliers and details.
CREATE OR REPLACE FUNCTION public.create_outlet(_account uuid, _name text, _city text DEFAULT '', _copy_from uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid; uid uuid := auth.uid(); allowed integer; used integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT is_account_owner(_account) THEN RAISE EXCEPTION 'Only the owner can add outlets'; END IF;
  IF length(trim(coalesce(_name,''))) = 0 THEN RAISE EXCEPTION 'Outlet name is required'; END IF;
  IF NOT account_is_live(_account) THEN RAISE EXCEPTION 'Your plan has ended. Renew it to add outlets.'; END IF;
  SELECT p.max_outlets INTO allowed FROM accounts a JOIN plans p ON p.id = a.plan_id WHERE a.id = _account;
  SELECT count(*) INTO used FROM restaurants WHERE account_id = _account;
  IF used >= coalesce(allowed, 1) THEN
    RAISE EXCEPTION 'Your plan allows % outlet%. Upgrade to add more.', allowed, CASE WHEN allowed = 1 THEN '' ELSE 's' END;
  END IF;
  INSERT INTO restaurants (name, created_by, account_id, slug, city) VALUES (trim(_name), uid, _account, unique_slug(_name), trim(coalesce(_city,''))) RETURNING id INTO rid;
  INSERT INTO restaurant_members (restaurant_id, user_id, role, display_name, email)
  SELECT rid, uid, 'owner', coalesce((SELECT display_name FROM profiles WHERE id = uid), ''), coalesce((SELECT email FROM auth.users WHERE id = uid), '');
  IF _copy_from IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM restaurants WHERE id = _copy_from AND account_id = _account)
       OR NOT has_restaurant_role(_copy_from, uid, ARRAY['owner','manager']::restaurant_role[]) THEN
      RAISE EXCEPTION 'You can only copy from your own outlets';
    END IF;
    INSERT INTO restaurant_records (restaurant_id, kind, record_id, payload, deleted)
    SELECT rid, kind, record_id,
           CASE WHEN kind = 'settings' THEN jsonb_set(payload, '{name}', to_jsonb(trim(_name))) ELSE payload END,
           false
    FROM restaurant_records
    WHERE restaurant_id = _copy_from AND NOT deleted AND kind IN ('settings','menu','material','supplier');
  END IF;
  INSERT INTO account_events (account_id, kind, detail, by_user) VALUES (_account, 'outlet_added', jsonb_build_object('outlet', rid, 'name', trim(_name)), uid);
  RETURN rid;
END $$;

-- Send one outlet's dishes and stock items to other outlets of the same account.
-- Dishes with the same id are replaced; dishes that exist only at a target outlet stay.
CREATE OR REPLACE FUNCTION public.push_menu(_from uuid, _to uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); target uuid; acc uuid; n integer := 0; c integer;
BEGIN
  IF NOT has_restaurant_role(_from, uid, ARRAY['owner','manager']::restaurant_role[]) THEN RAISE EXCEPTION 'Only owners and managers can push the menu'; END IF;
  SELECT account_id INTO acc FROM restaurants WHERE id = _from;
  FOREACH target IN ARRAY coalesce(_to, ARRAY[]::uuid[]) LOOP
    CONTINUE WHEN target = _from;
    IF NOT EXISTS (SELECT 1 FROM restaurants WHERE id = target AND account_id IS NOT DISTINCT FROM acc)
       OR NOT has_restaurant_role(target, uid, ARRAY['owner','manager']::restaurant_role[]) THEN
      RAISE EXCEPTION 'You can only push the menu to outlets you manage';
    END IF;
    INSERT INTO restaurant_records (restaurant_id, kind, record_id, payload, deleted)
    SELECT target, kind, record_id, payload, deleted FROM restaurant_records WHERE restaurant_id = _from AND kind IN ('menu','material')
    ON CONFLICT (restaurant_id, kind, record_id) DO UPDATE SET payload = EXCLUDED.payload, deleted = EXCLUDED.deleted;
    GET DIAGNOSTICS c = ROW_COUNT;
    n := n + c;
  END LOOP;
  RETURN n;
END $$;

-- Daily sales per outlet for the outlets the caller belongs to (row security applies).
CREATE OR REPLACE FUNCTION public.outlet_sales(_outlets uuid[], _from timestamptz, _to timestamptz)
RETURNS TABLE (restaurant_id uuid, day date, bills bigint, net numeric, tax numeric, dine_in numeric, takeaway numeric, delivery numeric, aggregator numeric, guest_ordered numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH o AS (
    SELECT r.restaurant_id, r.payload,
           to_timestamp((r.payload ->> 'createdAt')::numeric / 1000) AS at
    FROM restaurant_records r
    WHERE r.restaurant_id = ANY(_outlets) AND r.kind = 'order' AND NOT r.deleted
      AND r.updated_at >= _from
      AND r.payload ->> 'status' = 'settled'
      AND (r.payload ->> 'createdAt') ~ '^[0-9]+(\.[0-9]+)?$'
  )
  SELECT o.restaurant_id, (o.at AT TIME ZONE 'Asia/Kolkata')::date AS day, count(*),
    sum(coalesce((o.payload ->> 'total')::numeric, 0)),
    sum(coalesce((o.payload ->> 'cgst')::numeric, 0) + coalesce((o.payload ->> 'sgst')::numeric, 0)),
    sum(CASE WHEN o.payload ->> 'orderType' = 'dine-in' THEN coalesce((o.payload ->> 'total')::numeric, 0) ELSE 0 END),
    sum(CASE WHEN o.payload ->> 'orderType' = 'takeaway' THEN coalesce((o.payload ->> 'total')::numeric, 0) ELSE 0 END),
    sum(CASE WHEN o.payload ->> 'orderType' = 'delivery' THEN coalesce((o.payload ->> 'total')::numeric, 0) ELSE 0 END),
    sum(CASE WHEN o.payload ->> 'orderType' IN ('swiggy','zomato') THEN coalesce((o.payload ->> 'total')::numeric, 0) ELSE 0 END),
    sum(CASE WHEN o.payload ->> 'source' IN ('qr','online') THEN coalesce((o.payload ->> 'total')::numeric, 0) ELSE 0 END)
  FROM o WHERE o.at >= _from AND o.at < _to
  GROUP BY 1, 2 ORDER BY 2, 1
$$;

-- Owners keep their billing contact details up to date.
CREATE OR REPLACE FUNCTION public.update_account_billing(_account uuid, _name text, _email text, _phone text, _gstin text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_account_owner(_account) THEN RAISE EXCEPTION 'Only the owner can change billing details'; END IF;
  UPDATE accounts SET name = coalesce(nullif(trim(_name), ''), name), billing_email = trim(coalesce(_email,'')),
    billing_phone = trim(coalesce(_phone,'')), billing_gstin = upper(trim(coalesce(_gstin,''))) WHERE id = _account;
END $$;

-- Staff limit per plan, checked when an invite is sent.
CREATE OR REPLACE FUNCTION public.check_staff_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE acc uuid; allowed integer; used integer;
BEGIN
  SELECT account_id INTO acc FROM restaurants WHERE id = NEW.restaurant_id;
  IF acc IS NULL THEN RETURN NEW; END IF;
  SELECT p.max_staff INTO allowed FROM accounts a JOIN plans p ON p.id = a.plan_id WHERE a.id = acc;
  SELECT (SELECT count(DISTINCT m.user_id) FROM restaurant_members m JOIN restaurants r ON r.id = m.restaurant_id WHERE r.account_id = acc)
       + (SELECT count(*) FROM restaurant_invites i JOIN restaurants r ON r.id = i.restaurant_id WHERE r.account_id = acc)
    INTO used;
  IF used >= coalesce(allowed, 5) THEN
    RAISE EXCEPTION 'Your plan allows % staff logins. Upgrade to add more.', allowed;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS restaurant_invites_staff_limit ON public.restaurant_invites;
CREATE TRIGGER restaurant_invites_staff_limit BEFORE INSERT ON public.restaurant_invites FOR EACH ROW EXECUTE FUNCTION public.check_staff_limit();

/* ------------------------------------------------------- guest ordering */

CREATE TABLE IF NOT EXISTS public.guest_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  code text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('table','online')),
  table_id text,
  table_label text,
  customer_name text NOT NULL DEFAULT '',
  customer_phone text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  pickup_at timestamptz,
  -- [{itemId, variantId?, addonIds[], qty, note?, name, price, veg, menuName}]
  lines jsonb NOT NULL,
  subtotal numeric NOT NULL DEFAULT 0,
  payment text NOT NULL DEFAULT 'counter' CHECK (payment IN ('counter','upi')),
  upi_ref text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','accepted','ready','completed','rejected','cancelled')),
  reason text NOT NULL DEFAULT '',
  order_uid text,
  bill_no text,
  handled_by text NOT NULL DEFAULT '',
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guest_orders_queue ON public.guest_orders (restaurant_id, status, created_at DESC);

ALTER TABLE public.guest_orders ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.guest_orders TO authenticated;
GRANT ALL ON public.guest_orders TO service_role;
DROP POLICY IF EXISTS "staff read guest orders" ON public.guest_orders;
DROP POLICY IF EXISTS "staff handle guest orders" ON public.guest_orders;
CREATE POLICY "staff read guest orders" ON public.guest_orders FOR SELECT TO authenticated USING (public.is_member(restaurant_id, auth.uid()));
CREATE POLICY "staff handle guest orders" ON public.guest_orders FOR UPDATE TO authenticated
  USING (public.is_member(restaurant_id, auth.uid())) WITH CHECK (public.is_member(restaurant_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_guest_order() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS
$$ BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS guest_orders_touch ON public.guest_orders;
CREATE TRIGGER guest_orders_touch BEFORE UPDATE ON public.guest_orders FOR EACH ROW EXECUTE FUNCTION public.touch_guest_order();

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_orders;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;

-- What a guest sees at /order/<slug>: the outlet, its open channels and its menu (without recipes).
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
    'menu', coalesce(menu, '[]'::jsonb), 'tables', coalesce(tbls, '[]'::jsonb));
END $$;

-- Place a guest order. Prices always come from the outlet's menu, never from the guest's device.
CREATE OR REPLACE FUNCTION public.place_guest_order(
  _slug text, _channel text, _table_id text, _name text, _phone text, _note text,
  _lines jsonb, _payment text DEFAULT 'counter', _pickup_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rr restaurants; enabled boolean; tlabel text; line jsonb; item jsonb; variant jsonb; addon jsonb; addon_id text;
  qty integer; price numeric; lname text; out_lines jsonb := '[]'::jsonb; subtotal numeric := 0; order_type text;
  digits text := regexp_replace(coalesce(_phone, ''), '[^0-9]', '', 'g'); new_id uuid; new_token uuid; new_code text; min_order numeric;
  addon_names text; addon_ids jsonb;
BEGIN
  SELECT * INTO rr FROM restaurants WHERE slug = lower(trim(_slug));
  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
  IF _channel NOT IN ('table', 'online') THEN RAISE EXCEPTION 'Unknown order type'; END IF;
  enabled := CASE WHEN _channel = 'table'
    THEN coalesce((rr.ordering ->> 'table')::boolean, false) AND account_feature(rr.account_id, 'qr_ordering')
    ELSE coalesce((rr.ordering ->> 'online')::boolean, false) AND account_feature(rr.account_id, 'online_ordering') END;
  IF NOT enabled OR coalesce((rr.ordering ->> 'paused')::boolean, false) THEN
    RAISE EXCEPTION 'This restaurant is not taking orders here right now. Please ask the staff.';
  END IF;
  IF _payment NOT IN ('counter', 'upi') THEN RAISE EXCEPTION 'Unknown payment option'; END IF;

  IF _channel = 'table' THEN
    SELECT payload ->> 'label' INTO tlabel FROM restaurant_records WHERE restaurant_id = rr.id AND kind = 'table' AND record_id = _table_id AND NOT deleted;
    IF tlabel IS NULL THEN RAISE EXCEPTION 'This table QR code is out of date. Please ask the staff.'; END IF;
    order_type := 'dine-in';
  ELSE
    IF length(trim(coalesce(_name, ''))) < 2 THEN RAISE EXCEPTION 'Please enter your name'; END IF;
    IF length(digits) < 10 OR length(digits) > 13 THEN RAISE EXCEPTION 'Please enter a valid mobile number'; END IF;
    order_type := 'takeaway';
  END IF;

  IF jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN RAISE EXCEPTION 'Your order is empty'; END IF;
  IF jsonb_array_length(_lines) > 40 THEN RAISE EXCEPTION 'Too many dishes in one order'; END IF;

  -- Slow down repeated orders from one table or phone, and floods on one outlet.
  IF (SELECT count(*) FROM guest_orders WHERE restaurant_id = rr.id AND status = 'new' AND created_at > now() - interval '3 minutes'
        AND ((_channel = 'table' AND table_id = _table_id) OR (_channel = 'online' AND customer_phone = digits))) >= 3 THEN
    RAISE EXCEPTION 'You already have orders waiting. The staff will confirm them shortly.';
  END IF;
  IF (SELECT count(*) FROM guest_orders WHERE restaurant_id = rr.id AND created_at > now() - interval '1 minute') >= 40 THEN
    RAISE EXCEPTION 'The kitchen is very busy. Please try again in a minute.';
  END IF;

  FOR line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    qty := CASE WHEN (line ->> 'qty') ~ '^[0-9]{1,3}$' THEN (line ->> 'qty')::integer ELSE 0 END;
    IF qty < 1 OR qty > 30 THEN RAISE EXCEPTION 'Choose between 1 and 30 of each dish'; END IF;
    SELECT payload INTO item FROM restaurant_records
      WHERE restaurant_id = rr.id AND kind = 'menu' AND record_id = line ->> 'itemId' AND NOT deleted;
    IF item IS NULL OR NOT coalesce((item ->> 'available')::boolean, true) THEN
      RAISE EXCEPTION 'A dish in your order is no longer available. Please refresh the menu.';
    END IF;
    variant := NULL;
    IF jsonb_array_length(coalesce(item -> 'variants', '[]'::jsonb)) > 0 THEN
      SELECT v INTO variant FROM jsonb_array_elements(item -> 'variants') v WHERE v ->> 'id' = line ->> 'variantId';
      IF variant IS NULL THEN RAISE EXCEPTION 'Choose a portion for %', item ->> 'name'; END IF;
      price := (variant ->> 'price')::numeric;
    ELSE
      price := coalesce((item #>> ARRAY['prices', order_type])::numeric, (item ->> 'price')::numeric);
    END IF;
    addon_names := '';
    addon_ids := '[]'::jsonb;
    FOR addon_id IN SELECT DISTINCT jsonb_array_elements_text(coalesce(line -> 'addonIds', '[]'::jsonb)) ORDER BY 1 LOOP
      SELECT a INTO addon FROM jsonb_array_elements(coalesce(item -> 'addons', '[]'::jsonb)) a WHERE a ->> 'id' = addon_id;
      IF addon IS NULL THEN RAISE EXCEPTION 'An extra for % is no longer offered. Please refresh the menu.', item ->> 'name'; END IF;
      price := price + (addon ->> 'price')::numeric;
      addon_names := addon_names || ' + ' || (addon ->> 'name');
      addon_ids := addon_ids || to_jsonb(addon_id);
    END LOOP;
    lname := CASE WHEN variant IS NULL THEN item ->> 'name' ELSE (item ->> 'name') || ' (' || (variant ->> 'name') || ')' END || addon_names;
    out_lines := out_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'itemId', item ->> 'id', 'variantId', variant ->> 'id', 'addonIds', addon_ids, 'qty', qty,
      'note', nullif(left(trim(coalesce(line ->> 'note', '')), 120), ''), 'name', lname, 'price', price,
      'veg', coalesce((variant ->> 'veg')::boolean, (item ->> 'veg')::boolean, false))));
    subtotal := subtotal + price * qty;
  END LOOP;

  min_order := coalesce((rr.ordering ->> 'minOrder')::numeric, 0);
  IF _channel = 'online' AND subtotal < min_order THEN RAISE EXCEPTION 'The minimum order for pickup is Rs %', min_order; END IF;

  new_code := CASE WHEN _channel = 'table' THEN 'Q' ELSE 'W' END || '-' || lpad((floor(random() * 10000))::integer::text, 4, '0');
  INSERT INTO guest_orders (restaurant_id, code, channel, table_id, table_label, customer_name, customer_phone, note, pickup_at, lines, subtotal, payment)
  VALUES (rr.id, new_code, _channel, CASE WHEN _channel = 'table' THEN _table_id END, tlabel,
          left(trim(coalesce(_name, '')), 60), digits, left(trim(coalesce(_note, '')), 240),
          CASE WHEN _channel = 'online' THEN _pickup_at END, out_lines, subtotal, _payment)
  RETURNING id, token INTO new_id, new_token;
  RETURN jsonb_build_object('id', new_id, 'token', new_token, 'code', new_code, 'subtotal', subtotal);
END $$;

-- A guest follows their order with the id and secret token they got when placing it.
CREATE OR REPLACE FUNCTION public.guest_order_status(_id uuid, _token uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', g.id, 'code', g.code, 'channel', g.channel, 'status', g.status, 'reason', g.reason,
    'tableLabel', g.table_label, 'lines', g.lines, 'subtotal', g.subtotal, 'payment', g.payment, 'billNo', g.bill_no,
    'createdAt', g.created_at, 'updatedAt', g.updated_at, 'pickupAt', g.pickup_at)
  FROM guest_orders g WHERE g.id = _id AND g.token = _token
$$;

-- A guest may cancel until the restaurant accepts, and may add their UPI reference.
CREATE OR REPLACE FUNCTION public.guest_order_update(_id uuid, _token uuid, _cancel boolean DEFAULT false, _upi_ref text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_status text;
BEGIN
  SELECT status INTO current_status FROM guest_orders WHERE id = _id AND token = _token;
  IF current_status IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF _cancel THEN
    IF current_status <> 'new' THEN RAISE EXCEPTION 'The kitchen has already started this order. Please ask the staff.'; END IF;
    UPDATE guest_orders SET status = 'cancelled', reason = 'Cancelled by guest' WHERE id = _id;
    RETURN 'cancelled';
  END IF;
  IF _upi_ref IS NOT NULL THEN
    UPDATE guest_orders SET upi_ref = left(regexp_replace(_upi_ref, '[^A-Za-z0-9]', '', 'g'), 40), payment = 'upi' WHERE id = _id;
  END IF;
  RETURN current_status;
END $$;

/* ---------------------------------------------------- platform console */

CREATE OR REPLACE FUNCTION public.admin_accounts() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'Only XTSY POS administrators can open the console'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY row ->> 'createdAt' DESC) FROM (
      SELECT jsonb_build_object(
        'id', a.id, 'name', a.name, 'planId', a.plan_id, 'status', a.status, 'trialEndsAt', a.trial_ends_at, 'paidUntil', a.paid_until,
        'billingEmail', a.billing_email, 'billingPhone', a.billing_phone, 'billingGstin', a.billing_gstin, 'notes', a.notes,
        'createdAt', a.created_at, 'live', account_is_live(a.id),
        'ownerEmail', (SELECT email FROM auth.users WHERE id = a.owner_id),
        'outlets', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'slug', r.slug, 'city', r.city) ORDER BY r.created_at), '[]'::jsonb) FROM restaurants r WHERE r.account_id = a.id),
        'staff', (SELECT count(DISTINCT m.user_id) FROM restaurant_members m JOIN restaurants r ON r.id = m.restaurant_id WHERE r.account_id = a.id),
        'lastActivity', (SELECT max(rec.updated_at) FROM restaurant_records rec JOIN restaurants r ON r.id = rec.restaurant_id WHERE r.account_id = a.id),
        'bills30d', (SELECT count(*) FROM restaurant_records rec JOIN restaurants r ON r.id = rec.restaurant_id
                     WHERE r.account_id = a.id AND rec.kind = 'order' AND rec.updated_at > now() - interval '30 days')
      ) AS row FROM accounts a
    ) rows), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.admin_update_account(_id uuid, _plan text, _status text, _trial_ends_at timestamptz, _paid_until timestamptz, _notes text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE before accounts;
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'Only XTSY POS administrators can change plans'; END IF;
  SELECT * INTO before FROM accounts WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
  UPDATE accounts SET plan_id = _plan, status = _status, trial_ends_at = _trial_ends_at, paid_until = _paid_until, notes = coalesce(_notes, '') WHERE id = _id;
  INSERT INTO account_events (account_id, kind, detail, by_user) VALUES (_id, 'plan_changed',
    jsonb_build_object('from', jsonb_build_object('plan', before.plan_id, 'status', before.status, 'paidUntil', before.paid_until, 'trialEndsAt', before.trial_ends_at),
                       'to', jsonb_build_object('plan', _plan, 'status', _status, 'paidUntil', _paid_until, 'trialEndsAt', _trial_ends_at)), auth.uid());
END $$;

-- Record a payment received outside the app (bank transfer, UPI) and extend the paid period.
CREATE OR REPLACE FUNCTION public.admin_record_payment(_id uuid, _amount numeric, _months integer, _reference text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE until timestamptz;
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'Only XTSY POS administrators can record payments'; END IF;
  IF _months IS NULL OR _months < 1 OR _months > 36 THEN RAISE EXCEPTION 'Months must be between 1 and 36'; END IF;
  UPDATE accounts SET status = 'active',
    paid_until = greatest(coalesce(paid_until, now()), now()) + make_interval(months => _months)
  WHERE id = _id RETURNING paid_until INTO until;
  IF until IS NULL THEN RAISE EXCEPTION 'Account not found'; END IF;
  INSERT INTO account_events (account_id, kind, detail, amount, by_user)
  VALUES (_id, 'payment', jsonb_build_object('months', _months, 'reference', coalesce(_reference, ''), 'paidUntil', until), _amount, auth.uid());
  RETURN until;
END $$;

CREATE OR REPLACE FUNCTION public.admin_save_plan(_id text, _name text, _monthly integer, _yearly integer, _max_outlets integer, _max_staff integer, _features jsonb, _active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN RAISE EXCEPTION 'Only XTSY POS administrators can change plans'; END IF;
  INSERT INTO plans (id, name, monthly_price, yearly_price, max_outlets, max_staff, features, active, sort)
  VALUES (_id, _name, _monthly, _yearly, _max_outlets, _max_staff, coalesce(_features, '{}'::jsonb), _active, (SELECT coalesce(max(sort), 0) + 1 FROM plans))
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, monthly_price = EXCLUDED.monthly_price, yearly_price = EXCLUDED.yearly_price,
    max_outlets = EXCLUDED.max_outlets, max_staff = EXCLUDED.max_staff, features = EXCLUDED.features, active = EXCLUDED.active;
END $$;

/* ----------------------------------------------------- function grants */

REVOKE EXECUTE ON FUNCTION public.unique_slug(text), public.create_outlet(uuid,text,text,uuid), public.push_menu(uuid,uuid[]),
  public.outlet_sales(uuid[],timestamptz,timestamptz), public.update_account_billing(uuid,text,text,text,text),
  public.admin_accounts(), public.admin_update_account(uuid,text,text,timestamptz,timestamptz,text),
  public.admin_record_payment(uuid,numeric,integer,text), public.admin_save_plan(text,text,integer,integer,integer,integer,jsonb,boolean),
  public.is_account_owner(uuid), public.is_account_member(uuid), public.is_platform_admin()
  FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_outlet(uuid,text,text,uuid), public.push_menu(uuid,uuid[]),
  public.outlet_sales(uuid[],timestamptz,timestamptz), public.update_account_billing(uuid,text,text,text,text),
  public.admin_accounts(), public.admin_update_account(uuid,text,text,timestamptz,timestamptz,text),
  public.admin_record_payment(uuid,numeric,integer,text), public.admin_save_plan(text,text,integer,integer,integer,integer,jsonb,boolean),
  public.is_account_owner(uuid), public.is_account_member(uuid), public.is_platform_admin()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_storefront(text), public.place_guest_order(text,text,text,text,text,text,jsonb,text,timestamptz),
  public.guest_order_status(uuid,uuid), public.guest_order_update(uuid,uuid,boolean,text), public.account_is_live(uuid), public.account_feature(uuid,text)
  TO anon, authenticated;
