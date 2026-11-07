-- Room service by QR. restaurants.ordering.rooms = { "on": [table ids], "priority": [table ids], "names": { id: name } }.
-- Priority rooms (e.g. Experience by XTSY) always take QR orders; other rooms in a "Rooms"
-- section only when switched on. Dining tables are unaffected.
DO $mig$
DECLARE def text;
BEGIN
  -- 1. The public storefront tells the guest page which rooms are open and their display names.
  def := pg_get_functiondef('public.public_storefront'::regproc);
  IF position('''rooms'', coalesce(rr.ordering -> ''rooms''' IN def) = 0 THEN
    def := replace(def, '''menu'', coalesce(menu, ''[]''::jsonb), ''tables'', coalesce(tbls, ''[]''::jsonb));',
      '''menu'', coalesce(menu, ''[]''::jsonb), ''tables'', coalesce(tbls, ''[]''::jsonb), ''rooms'', coalesce(rr.ordering -> ''rooms'', ''{}''::jsonb));');
    IF position('''rooms'', coalesce(rr.ordering -> ''rooms''' IN def) = 0 THEN RAISE EXCEPTION 'storefront patch did not apply'; END IF;
    EXECUTE def;
  END IF;

  -- 2. Placing an order to a room that isn't switched on is refused.
  def := pg_get_functiondef('public.place_guest_order'::regproc);
  IF position('Room service by QR is off' IN def) = 0 THEN
    def := replace(def, '    IF tlabel IS NULL THEN RAISE EXCEPTION ''This table QR code is out of date. Please ask the staff.''; END IF;',
      '    IF tlabel IS NULL THEN RAISE EXCEPTION ''This table QR code is out of date. Please ask the staff.''; END IF;
    IF EXISTS (SELECT 1 FROM restaurant_records WHERE restaurant_id = rr.id AND kind = ''table'' AND record_id = _table_id AND NOT deleted AND trim(coalesce(payload ->> ''section'', '''')) ~* ''^rooms?$'')
       AND NOT (coalesce(rr.ordering #> ''{rooms,on}'', ''[]''::jsonb) ? _table_id OR coalesce(rr.ordering #> ''{rooms,priority}'', ''[]''::jsonb) ? _table_id) THEN
      RAISE EXCEPTION ''Room service by QR is off for this room. Please call reception to order.'';
    END IF;');
    IF position('Room service by QR is off' IN def) = 0 THEN RAISE EXCEPTION 'order patch did not apply'; END IF;
    EXECUTE def;
  END IF;
END $mig$;

-- TAB Bistro: Experience by XTSY (Room 666) is always on; all other rooms start off.
UPDATE public.restaurants
   SET ordering = coalesce(ordering, '{}'::jsonb) || jsonb_build_object('rooms', jsonb_build_object(
         'on', coalesce(ordering #> '{rooms,on}', '[]'::jsonb),
         'priority', '["ROOM-666"]'::jsonb,
         'names', coalesce(ordering #> '{rooms,names}', '{}'::jsonb) || '{"ROOM-666": "Experience by XTSY"}'::jsonb))
 WHERE id = '66c66ac4-efce-492b-b709-1c2b38d9cd78';
