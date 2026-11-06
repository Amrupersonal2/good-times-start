CREATE TYPE public.app_role AS ENUM ('owner', 'staff');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own role" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.create_restaurant_user_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  assigned_role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''), NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''), split_part(COALESCE(NEW.email, ''), '@', 1), 'Staff'))
  ON CONFLICT (id) DO NOTHING;

  PERFORM pg_advisory_xact_lock(74192841);
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'owner') THEN
    assigned_role := 'owner';
  ELSE
    assigned_role := 'staff';
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, assigned_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_restaurant_records
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.create_restaurant_user_records();

CREATE TABLE public.cloud_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bill_no text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, bill_no)
);
GRANT SELECT, INSERT, UPDATE ON public.cloud_orders TO authenticated;
GRANT ALL ON public.cloud_orders TO service_role;
ALTER TABLE public.cloud_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own cloud orders" ON public.cloud_orders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own cloud orders" ON public.cloud_orders FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own cloud orders" ON public.cloud_orders FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'units',
  quantity numeric NOT NULL DEFAULT 0,
  low_stock_threshold numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_items TO authenticated;
GRANT ALL ON public.inventory_items TO service_role;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own inventory" ON public.inventory_items FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own inventory" ON public.inventory_items FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own inventory" ON public.inventory_items FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own inventory" ON public.inventory_items FOR DELETE TO authenticated USING (auth.uid() = user_id);