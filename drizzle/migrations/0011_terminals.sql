-- XTSY POS round 9: terminals. Every device that uses the restaurant shows up
-- here (counter computer, waiter phones, the admin's phone), with its bill
-- series, app, login and last activity. The admin can rename, block or release
-- a terminal. Run after 0010. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.terminals (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
  device_id text NOT NULL CHECK (device_id ~ '^[a-z0-9-]{8,64}$'),
  series text NOT NULL DEFAULT '' CHECK (length(series) <= 12),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 60),
  app text NOT NULL DEFAULT '' CHECK (app IN ('', 'manager', 'pos', 'waiter')),
  device_kind text NOT NULL DEFAULT '' CHECK (device_kind IN ('', 'android', 'ios', 'desktop')),
  login_email text NOT NULL DEFAULT '',
  user_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, device_id)
);

ALTER TABLE public.terminals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins see terminals" ON public.terminals;
DROP POLICY IF EXISTS "admins change terminals" ON public.terminals;
DROP POLICY IF EXISTS "admins release terminals" ON public.terminals;
CREATE POLICY "admins see terminals" ON public.terminals FOR SELECT TO authenticated
  USING (public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]));
CREATE POLICY "admins change terminals" ON public.terminals FOR UPDATE TO authenticated
  USING (public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]))
  WITH CHECK (public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]));
CREATE POLICY "admins release terminals" ON public.terminals FOR DELETE TO authenticated
  USING (public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]));
REVOKE ALL ON public.terminals FROM anon, authenticated;
GRANT SELECT, DELETE ON public.terminals TO authenticated;
GRANT UPDATE (description, status) ON public.terminals TO authenticated;

-- Each device checks in (on start and every few minutes). It can't change its
-- own name or status; the answer tells it whether the admin has blocked it.
CREATE OR REPLACE FUNCTION public.touch_terminal(_restaurant uuid, _device text, _series text, _app text, _kind text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_member(_restaurant, auth.uid()) THEN RETURN 'unknown'; END IF;
  INSERT INTO terminals (restaurant_id, device_id, series, app, device_kind, login_email, user_id)
  VALUES (_restaurant, lower(_device), left(coalesce(_series, ''), 12),
          CASE WHEN _app IN ('manager', 'pos', 'waiter') THEN _app ELSE '' END,
          CASE WHEN _kind IN ('android', 'ios', 'desktop') THEN _kind ELSE '' END,
          coalesce(auth.jwt() ->> 'email', ''), auth.uid())
  ON CONFLICT (restaurant_id, device_id) DO UPDATE SET
    series = EXCLUDED.series, app = EXCLUDED.app, device_kind = EXCLUDED.device_kind,
    login_email = EXCLUDED.login_email, user_id = EXCLUDED.user_id, last_seen = now()
  RETURNING status INTO result;
  RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.touch_terminal(uuid, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.touch_terminal(uuid, text, text, text, text) TO authenticated;
GRANT ALL ON public.terminals TO service_role;
