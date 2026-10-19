-- XTSY POS round 8: three internal logins instead of invites. Run after 0009. Safe to re-run.
--
--   admin@xtsy.pos     Admin        (owner)    Business Manager, and every other app
--   billdesk@xtsy.pos  Reception    (cashier)  Restro POS on the counter computer
--   waiter@xtsy.pos    Waiter       (captain)  POS Waiter on Android phones and tablets
--
-- xtsy.pos is not a real domain: no email is ever sent. The accounts are created
-- already confirmed by the app's server on first sign-in (see staff-logins.functions.ts),
-- and passwords are reset by the admin or by a WhatsApp code.

CREATE TABLE IF NOT EXISTS public.staff_logins (
  login text PRIMARY KEY CHECK (login IN ('admin', 'billdesk', 'waiter')),
  email text NOT NULL UNIQUE,
  role public.restaurant_role NOT NULL,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  -- Full number with country code, digits only, for WhatsApp reset codes.
  whatsapp text NOT NULL DEFAULT '' CHECK (whatsapp ~ '^([0-9]{11,15})?$'),
  -- Kinds of device this login may be used on.
  devices text[] NOT NULL DEFAULT ARRAY['android', 'ios', 'desktop']
    CHECK (cardinality(devices) > 0 AND devices <@ ARRAY['android', 'ios', 'desktop']),
  active boolean NOT NULL DEFAULT true CHECK (login <> 'admin' OR active),
  user_id uuid UNIQUE REFERENCES auth.users (id) ON DELETE SET NULL,
  restaurant_id uuid REFERENCES public.restaurants (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.staff_logins (login, email, role, display_name, whatsapp, devices) VALUES
  ('admin',    'admin@xtsy.pos',    'owner',   'Admin',     '918837317070', ARRAY['android', 'ios', 'desktop']),
  ('billdesk', 'billdesk@xtsy.pos', 'cashier', 'Reception', '',             ARRAY['desktop']),
  ('waiter',   'waiter@xtsy.pos',   'captain', 'Waiter',    '',             ARRAY['android'])
ON CONFLICT (login) DO NOTHING;

ALTER TABLE public.staff_logins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "see own login or all as admin" ON public.staff_logins;
DROP POLICY IF EXISTS "admins change logins" ON public.staff_logins;
CREATE POLICY "see own login or all as admin" ON public.staff_logins FOR SELECT TO authenticated
  USING (user_id = auth.uid()
    OR (restaurant_id IS NOT NULL AND public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[])));
CREATE POLICY "admins change logins" ON public.staff_logins FOR UPDATE TO authenticated
  USING (restaurant_id IS NOT NULL AND public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]))
  WITH CHECK (restaurant_id IS NOT NULL AND public.has_restaurant_role(restaurant_id, auth.uid(), ARRAY['owner','manager']::public.restaurant_role[]));
REVOKE ALL ON public.staff_logins FROM anon, authenticated;
GRANT SELECT ON public.staff_logins TO authenticated;
-- Only these can be changed from the app; email, role and links are fixed.
GRANT UPDATE (display_name, whatsapp, devices, active) ON public.staff_logins TO authenticated;

-- A login's access to the restaurant follows its on/off switch, enforced by the
-- database: switching a login off removes its membership at once, even on a
-- device that is still signed in. Switching it on restores it with its role.
CREATE OR REPLACE FUNCTION public.apply_staff_login() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.user_id IS NULL OR NEW.restaurant_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.active THEN
    INSERT INTO restaurant_members (restaurant_id, user_id, role, display_name, email)
    VALUES (NEW.restaurant_id, NEW.user_id, NEW.role, NEW.display_name, NEW.email)
    ON CONFLICT (restaurant_id, user_id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name, email = EXCLUDED.email;
  ELSE
    DELETE FROM restaurant_members WHERE restaurant_id = NEW.restaurant_id AND user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS staff_logins_apply ON public.staff_logins;
CREATE TRIGGER staff_logins_apply BEFORE INSERT OR UPDATE ON public.staff_logins
  FOR EACH ROW EXECUTE FUNCTION public.apply_staff_login();
REVOKE EXECUTE ON FUNCTION public.apply_staff_login() FROM public, anon, authenticated;

/* ------------------------------------------- WhatsApp password reset codes */

-- Server-only (no app access): hashed one-time codes with expiry and attempt limits.
CREATE TABLE IF NOT EXISTS public.password_reset_codes (
  login text PRIMARY KEY REFERENCES public.staff_logins (login) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  sent_in_window integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.password_reset_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_reset_codes FROM anon, authenticated;
GRANT ALL ON public.password_reset_codes, public.staff_logins TO service_role;
