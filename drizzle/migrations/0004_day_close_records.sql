-- XTSY POS: day-end cash drawer closes sync between devices.

ALTER TABLE public.restaurant_records DROP CONSTRAINT IF EXISTS restaurant_records_kind_check;
ALTER TABLE public.restaurant_records ADD CONSTRAINT restaurant_records_kind_check CHECK (
  kind IN ('settings', 'menu', 'table', 'order', 'kot', 'inventory', 'material', 'supplier', 'stock_entry', 'customer', 'day_close')
);
