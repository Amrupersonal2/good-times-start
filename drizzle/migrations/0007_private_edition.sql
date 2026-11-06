-- XTSY POS private edition: one owner's system, not public software.
-- Run after 0006. Safe to run more than once.
--
-- 1. The owner's accounts move to an unlisted "Owner" plan with every feature
--    and room to grow (50 outlets, 500 staff logins), and never expire.
-- 2. Strangers who sign up can't create their own restaurant; staff join by
--    invite. Only the platform administrator (the owner) can create one.

INSERT INTO public.plans (id, name, monthly_price, yearly_price, max_outlets, max_staff, features, sort, active)
VALUES ('owner', 'Owner', 0, 0, 50, 500, '{"qr_ordering":true,"online_ordering":true,"multi_outlet":true,"insights":true}', 99, false)
ON CONFLICT (id) DO UPDATE SET max_outlets = EXCLUDED.max_outlets, max_staff = EXCLUDED.max_staff, features = EXCLUDED.features, active = false;

UPDATE public.accounts SET plan_id = 'owner', status = 'active', trial_ends_at = NULL, paid_until = NULL,
  notes = 'Private edition: owner account.'
WHERE plan_id <> 'owner';

CREATE OR REPLACE FUNCTION public.create_restaurant(_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid; aid uuid; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF EXISTS (SELECT 1 FROM restaurants) AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'This is a private system. Ask the owner to invite you.';
  END IF;
  IF length(trim(coalesce(_name,''))) = 0 THEN RAISE EXCEPTION 'Restaurant name is required'; END IF;
  INSERT INTO accounts (name, owner_id, plan_id, status, trial_ends_at) VALUES (trim(_name), uid, 'owner', 'active', NULL) RETURNING id INTO aid;
  INSERT INTO restaurants (name, created_by, account_id, slug) VALUES (trim(_name), uid, aid, unique_slug(_name)) RETURNING id INTO rid;
  INSERT INTO restaurant_members (restaurant_id, user_id, role, display_name, email)
  SELECT rid, uid, 'owner', coalesce((SELECT display_name FROM profiles WHERE id = uid), ''), coalesce((SELECT email FROM auth.users WHERE id = uid), '');
  INSERT INTO account_events (account_id, kind, detail, by_user) VALUES (aid, 'signup', jsonb_build_object('outlet', rid), uid);
  IF NOT EXISTS (SELECT 1 FROM platform_admins) THEN INSERT INTO platform_admins (user_id) VALUES (uid); END IF;
  RETURN rid;
END $$;
