-- XTSY POS: restaurant-scoped accounts, staff roles and live multi-device sync.
-- Additive only: cloud_orders, inventory_items and user_roles are left untouched.

CREATE TYPE public.restaurant_role AS ENUM ('owner', 'manager', 'cashier', 'captain', 'kitchen');

CREATE TABLE public.restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.restaurant_members (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.restaurant_role NOT NULL,
  display_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, user_id)
);
CREATE INDEX restaurant_members_user_idx ON public.restaurant_members (user_id);

CREATE TABLE public.restaurant_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 255),
  role public.restaurant_role NOT NULL,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, email)
);
CREATE INDEX restaurant_invites_email_idx ON public.restaurant_invites (email);

-- Every shared record (settings, menu items, tables, orders, KOTs, stock) lives here.
CREATE TABLE public.restaurant_records (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('settings', 'menu', 'table', 'order', 'kot', 'inventory')),
  record_id text NOT NULL CHECK (char_length(record_id) BETWEEN 1 AND 200),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(payload) < 262144),
  deleted boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (restaurant_id, kind, record_id)
);
CREATE INDEX restaurant_records_cursor_idx ON public.restaurant_records (restaurant_id, updated_at);

-- Server clock decides updated_at so device clocks can't break the pull cursor.
CREATE OR REPLACE FUNCTION public.touch_restaurant_record()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

CREATE TRIGGER restaurant_records_touch
BEFORE INSERT OR UPDATE ON public.restaurant_records
FOR EACH ROW EXECUTE FUNCTION public.touch_restaurant_record();

-- Membership helpers (SECURITY DEFINER so policies don't recurse through RLS).
CREATE OR REPLACE FUNCTION public.restaurant_role_of(_restaurant_id uuid)
RETURNS public.restaurant_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.restaurant_members
  WHERE restaurant_id = _restaurant_id AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_restaurant_member(_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_members
    WHERE restaurant_id = _restaurant_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_restaurant_admin(_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_members
    WHERE restaurant_id = _restaurant_id AND user_id = auth.uid() AND role IN ('owner', 'manager')
  );
$$;

-- Row level security
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_records ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON public.restaurants TO authenticated;
GRANT SELECT ON public.restaurant_members TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.restaurant_invites TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.restaurant_records TO authenticated;
GRANT ALL ON public.restaurants, public.restaurant_members, public.restaurant_invites, public.restaurant_records TO service_role;

CREATE POLICY "Members can read their restaurant" ON public.restaurants
  FOR SELECT TO authenticated USING (public.is_restaurant_member(id));
CREATE POLICY "Admins can rename their restaurant" ON public.restaurants
  FOR UPDATE TO authenticated USING (public.is_restaurant_admin(id)) WITH CHECK (public.is_restaurant_admin(id));

CREATE POLICY "Members can see their team" ON public.restaurant_members
  FOR SELECT TO authenticated USING (public.is_restaurant_member(restaurant_id));

CREATE POLICY "Admins can see invites" ON public.restaurant_invites
  FOR SELECT TO authenticated USING (public.is_restaurant_admin(restaurant_id));
CREATE POLICY "Admins can invite staff" ON public.restaurant_invites
  FOR INSERT TO authenticated WITH CHECK (
    public.is_restaurant_admin(restaurant_id)
    AND (role <> 'owner' OR public.restaurant_role_of(restaurant_id) = 'owner')
    AND invited_by = auth.uid()
  );
CREATE POLICY "Admins can cancel invites" ON public.restaurant_invites
  FOR DELETE TO authenticated USING (public.is_restaurant_admin(restaurant_id));

CREATE POLICY "Members can read shared records" ON public.restaurant_records
  FOR SELECT TO authenticated USING (public.is_restaurant_member(restaurant_id));
CREATE POLICY "Members can add shared records" ON public.restaurant_records
  FOR INSERT TO authenticated WITH CHECK (
    public.is_restaurant_member(restaurant_id)
    AND (kind <> 'settings' OR public.is_restaurant_admin(restaurant_id))
  );
CREATE POLICY "Members can update shared records" ON public.restaurant_records
  FOR UPDATE TO authenticated
  USING (public.is_restaurant_member(restaurant_id))
  WITH CHECK (
    public.is_restaurant_member(restaurant_id)
    AND (kind <> 'settings' OR public.is_restaurant_admin(restaurant_id))
  );

-- Account actions
CREATE OR REPLACE FUNCTION public.create_restaurant(_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Sign in to create a restaurant.'; END IF;
  IF char_length(trim(coalesce(_name, ''))) = 0 THEN RAISE EXCEPTION 'Enter the restaurant name.'; END IF;
  INSERT INTO public.restaurants (name, created_by) VALUES (left(trim(_name), 120), caller) RETURNING id INTO new_id;
  INSERT INTO public.restaurant_members (restaurant_id, user_id, role, display_name, email)
  SELECT new_id, caller, 'owner', coalesce(p.display_name, ''), coalesce(u.email, '')
  FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = caller;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_restaurant_invites()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  joined integer;
BEGIN
  IF caller IS NULL OR caller_email = '' THEN RETURN 0; END IF;
  INSERT INTO public.restaurant_members (restaurant_id, user_id, role, display_name, email)
  SELECT i.restaurant_id, caller, i.role, coalesce(p.display_name, ''), caller_email
  FROM public.restaurant_invites i
  LEFT JOIN public.profiles p ON p.id = caller
  WHERE i.email = caller_email
  ON CONFLICT (restaurant_id, user_id) DO NOTHING;
  GET DIAGNOSTICS joined = ROW_COUNT;
  DELETE FROM public.restaurant_invites WHERE email = caller_email;
  RETURN joined;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_member_role(_restaurant_id uuid, _user_id uuid, _role public.restaurant_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.restaurant_role_of(_restaurant_id) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only the owner can change staff roles.';
  END IF;
  IF _role <> 'owner' AND (
    SELECT count(*) FROM public.restaurant_members
    WHERE restaurant_id = _restaurant_id AND role = 'owner' AND user_id <> _user_id
  ) = 0 THEN
    RAISE EXCEPTION 'A restaurant needs at least one owner.';
  END IF;
  UPDATE public.restaurant_members SET role = _role
  WHERE restaurant_id = _restaurant_id AND user_id = _user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_member(_restaurant_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.restaurant_role_of(_restaurant_id) IS DISTINCT FROM 'owner' AND _user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the owner can remove staff.';
  END IF;
  IF (
    SELECT count(*) FROM public.restaurant_members
    WHERE restaurant_id = _restaurant_id AND role = 'owner' AND user_id <> _user_id
  ) = 0 THEN
    RAISE EXCEPTION 'A restaurant needs at least one owner.';
  END IF;
  DELETE FROM public.restaurant_members WHERE restaurant_id = _restaurant_id AND user_id = _user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restaurant_role_of(uuid), public.is_restaurant_member(uuid), public.is_restaurant_admin(uuid),
  public.create_restaurant(text), public.accept_restaurant_invites(),
  public.set_member_role(uuid, uuid, public.restaurant_role), public.remove_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurant_role_of(uuid), public.is_restaurant_member(uuid), public.is_restaurant_admin(uuid),
  public.create_restaurant(text), public.accept_restaurant_invites(),
  public.set_member_role(uuid, uuid, public.restaurant_role), public.remove_member(uuid, uuid) TO authenticated;

-- Live updates: other devices are told when shared records change.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurant_records;
  END IF;
END;
$$;

-- Carry the existing single-restaurant setup over: the current owner gets a
-- restaurant, existing staff become cashiers, and synced bills and stock move in.
DO $$
DECLARE
  owner_id uuid;
  rid uuid;
BEGIN
  SELECT user_id INTO owner_id FROM public.user_roles WHERE role = 'owner' LIMIT 1;
  IF owner_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.restaurants (name, created_by) VALUES ('My Restaurant', owner_id) RETURNING id INTO rid;

  INSERT INTO public.restaurant_members (restaurant_id, user_id, role, display_name, email)
  SELECT rid, r.user_id,
    CASE WHEN r.is_owner THEN 'owner'::public.restaurant_role ELSE 'cashier'::public.restaurant_role END,
    coalesce(p.display_name, ''), coalesce(u.email, '')
  FROM (
    SELECT user_id, bool_or(role = 'owner') AS is_owner FROM public.user_roles GROUP BY user_id
  ) r
  JOIN auth.users u ON u.id = r.user_id
  LEFT JOIN public.profiles p ON p.id = r.user_id
  ON CONFLICT (restaurant_id, user_id) DO NOTHING;

  -- Same uid formula the app uses for bills created before the revamp, so a
  -- device re-uploading its local copy lands on the same record.
  INSERT INTO public.restaurant_records (restaurant_id, kind, record_id, payload)
  SELECT DISTINCT ON (uid) rid, 'order', uid, payload || jsonb_build_object('uid', uid)
  FROM (
    SELECT 'legacy:' || bill_no || ':' || (payload ->> 'createdAt') AS uid, payload, created_at
    FROM public.cloud_orders
    WHERE (payload ->> 'createdAt') IS NOT NULL
  ) o
  ORDER BY uid, created_at DESC
  ON CONFLICT (restaurant_id, kind, record_id) DO NOTHING;

  INSERT INTO public.restaurant_records (restaurant_id, kind, record_id, payload)
  SELECT DISTINCT ON (menu_item_id) rid, 'inventory', menu_item_id, jsonb_build_object(
    'id', menu_item_id, 'menuItemId', menu_item_id, 'name', name, 'unit', unit,
    'quantity', quantity, 'lowStockThreshold', low_stock_threshold, 'tracked', true
  )
  FROM public.inventory_items
  WHERE menu_item_id IS NOT NULL
  ORDER BY menu_item_id, updated_at DESC
  ON CONFLICT (restaurant_id, kind, record_id) DO NOTHING;
END;
$$;
