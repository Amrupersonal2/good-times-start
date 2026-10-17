\set o random(0, 49)
\set t random(1, 100)
SET ROLE anon;
SELECT place_guest_order('outlet-' || :o, 'table', 't' || :t, '', '', '', '[{"itemId":"tab-black-tea","qty":2},{"itemId":"tab-fresh-lime","variantId":"tab-fresh-lime--fresh-lime-sweet","qty":1}]'::jsonb);
