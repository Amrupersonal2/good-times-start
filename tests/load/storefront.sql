\set o random(0, 49)
SET ROLE anon;
SELECT length(public_storefront('outlet-' || :o)::text);
