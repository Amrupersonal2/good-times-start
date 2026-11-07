ALTER TABLE public.terminals ADD COLUMN IF NOT EXISTS last_ip text, ADD COLUMN IF NOT EXISTS last_location text, ADD COLUMN IF NOT EXISTS network_seen_at timestamptz;
COMMENT ON COLUMN public.terminals.last_ip IS 'Public IP the terminal last checked in from (recorded server-side).';
COMMENT ON COLUMN public.terminals.last_location IS 'Approximate city/region/country from the IP (not GPS).';