-- XTSY POS: allow stock ledger and customer records to sync between devices.
-- Raw materials, suppliers, stock entries (purchases, wastage, counts, sales
-- consumption) and the customer directory all live in restaurant_records.

ALTER TABLE public.restaurant_records DROP CONSTRAINT IF EXISTS restaurant_records_kind_check;
ALTER TABLE public.restaurant_records ADD CONSTRAINT restaurant_records_kind_check CHECK (
  kind IN ('settings', 'menu', 'table', 'order', 'kot', 'inventory', 'material', 'supplier', 'stock_entry', 'customer')
);
