DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='restaurant_role') THEN
    CREATE TYPE public.restaurant_role AS ENUM ('owner','manager','cashier','captain','kitchen');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.restaurant_members (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.restaurant_role NOT NULL DEFAULT 'cashier',
  display_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.restaurant_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.restaurant_role NOT NULL DEFAULT 'cashier',
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, email)
);
CREATE TABLE IF NOT EXISTS public.restaurant_records (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  kind text NOT NULL,
  record_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, kind, record_id)
);
CREATE INDEX IF NOT EXISTS restaurant_records_cursor ON public.restaurant_records (restaurant_id, updated_at);

GRANT SELECT, UPDATE ON public.restaurants TO authenticated;
GRANT SELECT ON public.restaurant_members TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.restaurant_invites TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.restaurant_records TO authenticated;
GRANT ALL ON public.restaurants, public.restaurant_members, public.restaurant_invites, public.restaurant_records TO service_role;

ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_records ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_member(_rid uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM restaurant_members WHERE restaurant_id=_rid AND user_id=_uid) $$;
CREATE OR REPLACE FUNCTION public.has_restaurant_role(_rid uuid, _uid uuid, _roles public.restaurant_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM restaurant_members WHERE restaurant_id=_rid AND user_id=_uid AND role = ANY(_roles)) $$;

DROP POLICY IF EXISTS "members read restaurant" ON public.restaurants;
DROP POLICY IF EXISTS "owners rename restaurant" ON public.restaurants;
DROP POLICY IF EXISTS "members read team" ON public.restaurant_members;
DROP POLICY IF EXISTS "managers read invites" ON public.restaurant_invites;
DROP POLICY IF EXISTS "managers add invites" ON public.restaurant_invites;
DROP POLICY IF EXISTS "managers remove invites" ON public.restaurant_invites;
DROP POLICY IF EXISTS "members read records" ON public.restaurant_records;
DROP POLICY IF EXISTS "members write records" ON public.restaurant_records;
DROP POLICY IF EXISTS "members update records" ON public.restaurant_records;

CREATE POLICY "members read restaurant" ON public.restaurants FOR SELECT TO authenticated USING (public.is_member(id, auth.uid()));
CREATE POLICY "owners rename restaurant" ON public.restaurants FOR UPDATE TO authenticated
  USING (public.has_restaurant_role(id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]))
  WITH CHECK (public.has_restaurant_role(id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]));
CREATE POLICY "members read team" ON public.restaurant_members FOR SELECT TO authenticated USING (public.is_member(restaurant_id, auth.uid()));
CREATE POLICY "managers read invites" ON public.restaurant_invites FOR SELECT TO authenticated
  USING (public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]));
CREATE POLICY "managers add invites" ON public.restaurant_invites FOR INSERT TO authenticated
  WITH CHECK (public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]) AND (role <> 'owner' OR public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner']::public.restaurant_role[])));
CREATE POLICY "managers remove invites" ON public.restaurant_invites FOR DELETE TO authenticated
  USING (public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]));
CREATE POLICY "members read records" ON public.restaurant_records FOR SELECT TO authenticated USING (public.is_member(restaurant_id, auth.uid()));
CREATE POLICY "members write records" ON public.restaurant_records FOR INSERT TO authenticated WITH CHECK (public.is_member(restaurant_id, auth.uid()));
CREATE POLICY "members update records" ON public.restaurant_records FOR UPDATE TO authenticated USING (public.is_member(restaurant_id, auth.uid())) WITH CHECK (public.is_member(restaurant_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_record() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS
$$ BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS restaurant_records_touch ON public.restaurant_records;
CREATE TRIGGER restaurant_records_touch BEFORE INSERT OR UPDATE ON public.restaurant_records FOR EACH ROW EXECUTE FUNCTION public.touch_record();

DROP FUNCTION IF EXISTS public.create_restaurant(text);
DROP FUNCTION IF EXISTS public.accept_restaurant_invites();
DROP FUNCTION IF EXISTS public.set_member_role(uuid,uuid,public.restaurant_role);
DROP FUNCTION IF EXISTS public.remove_member(uuid,uuid);

CREATE FUNCTION public.create_restaurant(_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF length(trim(coalesce(_name,''))) = 0 THEN RAISE EXCEPTION 'Restaurant name is required'; END IF;
  INSERT INTO restaurants(name, created_by) VALUES (trim(_name), uid) RETURNING id INTO rid;
  INSERT INTO restaurant_members(restaurant_id, user_id, role, display_name, email)
  SELECT rid, uid, 'owner', coalesce((SELECT display_name FROM profiles WHERE id=uid),''), coalesce((SELECT email FROM auth.users WHERE id=uid),'');
  RETURN rid;
END $$;

CREATE FUNCTION public.accept_restaurant_invites() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); mail text;
BEGIN
  IF uid IS NULL THEN RETURN; END IF;
  SELECT lower(email) INTO mail FROM auth.users WHERE id=uid AND email_confirmed_at IS NOT NULL;
  IF mail IS NULL THEN RETURN; END IF;
  INSERT INTO restaurant_members(restaurant_id, user_id, role, display_name, email)
  SELECT i.restaurant_id, uid, i.role, coalesce((SELECT display_name FROM profiles WHERE id=uid),''), mail
  FROM restaurant_invites i WHERE lower(i.email)=mail
  ON CONFLICT (restaurant_id, user_id) DO NOTHING;
  DELETE FROM restaurant_invites WHERE lower(email)=mail;
END $$;

CREATE FUNCTION public.set_member_role(_restaurant_id uuid, _user_id uuid, _role public.restaurant_role) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT has_restaurant_role(_restaurant_id, auth.uid(), ARRAY['owner']::restaurant_role[]) THEN RAISE EXCEPTION 'Only the owner can change roles'; END IF;
  IF _user_id = auth.uid() AND _role <> 'owner' AND (SELECT count(*) FROM restaurant_members WHERE restaurant_id=_restaurant_id AND role='owner') < 2 THEN
    RAISE EXCEPTION 'The restaurant needs at least one owner'; END IF;
  UPDATE restaurant_members SET role=_role WHERE restaurant_id=_restaurant_id AND user_id=_user_id;
END $$;

CREATE FUNCTION public.remove_member(_restaurant_id uuid, _user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT has_restaurant_role(_restaurant_id, auth.uid(), ARRAY['owner']::restaurant_role[]) THEN RAISE EXCEPTION 'Only the owner can remove staff'; END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot remove yourself'; END IF;
  DELETE FROM restaurant_members WHERE restaurant_id=_restaurant_id AND user_id=_user_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_restaurant(text), public.accept_restaurant_invites(), public.set_member_role(uuid,uuid,public.restaurant_role), public.remove_member(uuid,uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_restaurant(text), public.accept_restaurant_invites(), public.set_member_role(uuid,uuid,public.restaurant_role), public.remove_member(uuid,uuid) TO authenticated;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurant_records;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;