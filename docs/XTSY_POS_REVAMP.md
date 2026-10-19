# XTSY POS — Revamp Plan

XTSY POS is an offline-first, multi-device restaurant POS sold as SaaS to Indian
restaurants (benchmarks: Petpooja, Zoho POS). One restaurant account runs many
devices — billing counter, waiter phones, kitchen screens — that share the same
menu, tables, open orders and kitchen tickets, and keep billing when the
internet drops.

All revamp work lands on the `revamp` branch and is merged into `main` (which
syncs to Lovable and the live app) only after review in Lovable.

## Principles

- **Offline first.** IndexedDB on each device stays the source of truth for the
  screen. Billing, KOTs and the kitchen board never wait on the network.
- **Restaurant, not user, owns data.** Every cloud record belongs to a
  restaurant; staff see it through their membership and role.
- **Never lose a bill.** Schema changes are additive. Existing devices back up
  their local bills, menu, tables and stock to the restaurant on first sync.
- **GST-correct bills.** Bills print the restaurant's own legal details and a
  unique bill number per device series (`INV/26-27/C1/0001`).

## Phases

### Phase 1 — Foundation
- [x] Restaurant profile: name, address, phone, GSTIN, FSSAI, UPI ID, bill footer
- [x] No demo restaurant details on bills; XTSY POS branding
- [x] Restaurant-scoped cloud data with roles: owner, manager, cashier, captain, kitchen
- [x] Staff invites by email; new sign-ups create their own restaurant
- [x] Live sync of menu, tables, open orders, KOTs, stock and settings across devices
- [x] Per-device bill series code
- [x] Opening a table on any device shows its running order
- [x] Design refresh: XTSY POS design tokens, app shell, settings

### Phase 2 — Menu & floor
- [x] Menu builder: add/edit/delete items and categories, kitchen stations
- [x] Variants (half/full), add-ons, order-type pricing, stock per dish
- [x] Floor builder: sections and tables; move and merge tables

### Phase 3 — Billing
- [x] Split payments and split bills, UPI QR on screen
- [x] Void/cancel with reason (owners and managers only), reprint
- [x] Service charge, discount limits by role, customer phone on bill

### Phase 4 — Kitchen & captain
- [x] Kitchen display tuned for wall screens (stations, ageing, chime), KOT reprint, cancellation tickets
- [x] Captain (waiter) mobile ordering; role-based screens for captains and kitchen staff

### Phase 5 — Inventory & purchase
- [x] Raw materials, recipes, auto-deduction, purchases, suppliers, wastage

### Phase 6 — Customers
- [x] Customer directory, visit history, loyalty points (spend as payment), dues collection, feedback

### Phase 7 — Reports
- [x] Day-end and shift close, cash drawer, GST report, item/category/staff
      sales, date ranges, export

### Phase 8 — SaaS
- [x] Onboarding wizard, multiple outlets, subscription plans, admin console (round 3)
- [ ] Online subscription payments (Razorpay or similar) — plans are renewed by recording payments in the admin console for now
- [ ] Aggregator orders (Swiggy/Zomato) — needs partner API approval

## Sync architecture (Phase 1)

```
 device IndexedDB ──write──▶ outbox ──push──▶ restaurant_records (Postgres, RLS)
        ▲                                         │
        └──────── pull (cursor on updated_at) ◀───┘◀── realtime change ping
```

- `restaurant_records(restaurant_id, kind, record_id, payload, deleted, updated_at)`
  holds every shared record. `kind` is one of `settings`, `menu`, `table`,
  `order`, `kot`, `inventory`.
- Each local write marks the record dirty in the device outbox. Push upserts the
  latest local copy; pull applies newer server rows unless the record still has
  unpushed local changes (local edits win until pushed).
- Orders and KOTs carry a global `uid`; numeric IndexedDB ids stay local.
- Raw-material stock is an append-only ledger (`stock_entry` records:
  purchases, recipe consumption per bill, wastage, counts, returns). Levels
  are the sum of entries, so concurrent sales on two devices can't overwrite
  each other. Sale entries are keyed by bill, so a bill can't deduct twice.
- Realtime notifications on `restaurant_records` trigger a pull so other devices
  see new KOTs and table changes within seconds.

## Round 2 (October 2026) — `revamp-2`

- [x] TAB Bistro by XTSY menu: 131 dishes, portions, add-ons, 95 ingredients, a recipe for every dish
- [x] Excel engine (no extra packages); menu import/export; stock, reports, guests and GSTR-1 workbooks
- [x] GST modes (regular / composition / unregistered), inclusive prices, Swiggy/Zomato u/s 9(5), round-off, SAC
- [x] Billing settings (service charge, discount limit, loyalty, payment modes, auto-KOT on settle)
- [x] GST-compliant bill numbers (≤16 characters): `C1/26-27/0001`
- [x] KOT and bill printing per device (paper, copies, stations, incoming KOTs, auto-print) via one print service
- [x] Speed: indexed running bills and guests, cached stock levels (local DB v7)
- [x] Multi-device sync simulation and year-of-data speed budgets (`src/test`)
- [x] Installable apps: XTSY POS (`/`), XTSY Waiter (`/waiter`, tablet), XTSY Insights (`/insights`, phone)

### Testing notes
- `src/test/sync-simulation.test.ts` runs the real sync code against in-memory
  stand-ins (`src/test/fakes`) for IndexedDB and the server.
- `src/test/performance.test.ts` holds speed budgets for ~60,000 bills.

## Round 3 (October 2026) — `revamp-3`

Database: `drizzle/migrations/0006_outlets_plans_guest_ordering.sql` (additive,
safe to re-run). Existing restaurants become complimentary Chain accounts; the
first restaurant's creator becomes the platform administrator.

- [x] QR ordering at tables: `/order/<outlet>?table=<id>`; orders add to the table's running bill
- [x] Online ordering for pickup: `/order/<outlet>`, pickup time, minimum order, pay at pickup or by UPI
- [x] Prices are always set by the database from the outlet's menu, never by the guest's phone
- [x] Guest orders ring on every counter (realtime + chime); accept claims the order once, sends KOTs and opens the bill
- [x] Running pickup bills listed at the counter; open, add to, settle
- [x] Settings → Guest ordering: switches, pause, web address, link + QR, printable A4 table cards
- [x] Accounts and plans (Free trial 14 days, Starter, Growth, Chain) with outlet and staff limits; billing never stops when a plan lapses
- [x] Business page: plan, outlets, add outlet (copy menu/stock/details), send menu to outlets, sales across outlets
- [x] Safe outlet switch on a device (refuses while changes are unsynced or bills are running)
- [x] Setup wizard for new restaurants: details, GST, menu, tables, printing, team
- [x] Admin console `/admin`: accounts, plan/status/trial/paid-until, record payments, edit plans, revenue
- [x] Fix: only owners and managers can change restaurant settings in the cloud (an earlier policy let any member)

### Applying the migration
Lovable Cloud does not run SQL files from GitHub by itself. After merging, ask
the Lovable agent: "Run drizzle/migrations/0006_outlets_plans_guest_ordering.sql
on the database." The app keeps working before it runs; guest ordering, plans
and outlets appear once it has.

## Round 4 (October 2026) — `revamp-4`: Apple-style redesign and load testing

- [x] Apple system palette (grouped grey canvas, white surfaces, one blue tint; full dark appearance) and the device's own system font (no web-font download)
- [x] Frosted header and phone tab bar; macOS-style sidebar
- [x] One dropdown for the whole app (`src/components/Dropdown.tsx`): native-feeling menus, with search for long lists (ingredients, tables grouped by section); all 21 browser dropdowns replaced
- [x] Segmented controls for order type and every tab bar (`src/components/Segmented.tsx`)
- [x] Billing screen: grouped bill lines, compact steppers, quieter notes and totals
- [x] Shorter on-screen text across settings, stock, outlets and guest ordering
- [x] Load tests: 7-device rush (1,050 bills + KOTs), flaky network, new device catching up on 4,000 records (`src/test/load.test.ts`)
- [x] Database load tests with pgbench and results (`tests/load/`)

### Speed and always-on sync (round 4, part 2)
- [x] Persistent frame: sidebar, header, sync chip and the live orders connection stay mounted across staff pages; only the page swaps
- [x] Page code preloads on hover/touch and, after the first screen, every staff screen preloads while the device is idle (cached by the service worker for offline)
- [x] Cloud data stays fresh for 30 s, so page changes don't refetch it; quick page changes never flash a loading state; 120 ms cross-fade
- [x] Sync scheduler (`src/lib/sync-scheduler.ts`): syncs within 2 s of edits even during a rush (the old debounce could postpone indefinitely), retries at 2/5/15/30/60 s, polls every 15 s while the live connection is down and 60 s while up
- [x] Live connection reconnects itself with back-off and catches up on reconnect; syncs when the app returns to the screen, the network returns or a sleeping tablet wakes
- [x] One sync at a time per device across tabs (Web Locks)
- [x] Sync chip shows Live / Reconnecting…
- [x] Guests page reads only bills with a guest (indexed) instead of every bill; older pulled bills get the guest index

### Owner dashboard (round 4, part 3)
- [x] `/dashboard` (owners and managers, first in the menu): Business overview and Live status tabs, in the style of the back-office tools owners know
- [x] Overview: period presets or custom dates; sales, bills, average bill, purchases; sales by order type with share; daily sales chart (this/last week, last 15 days, this/last month); revenue leakage (cancelled bills, items cancelled after KOT, discounted, complimentary and unpaid bills); discounts and GST; billing vs guest-order sales; payment breakup; plan card
- [x] Live status: a card per running bill (table or pickup) with guest, dishes and expected total, updating live
- [x] Dark slate side menu that expands to labels (remembered per device)
- [x] Logic in `src/lib/dashboard-logic.ts` with tests; nothing shown that the app doesn't record (no expenses or reprint counts yet)

### Counter layout staff already know (round 4, part 4)
- [x] Top strip: one button per floor section (tap for that section's tables, coloured by status) plus Takeaway, Delivery, Swiggy, Zomato and running pickup bills
- [x] Category list on the left; dense dish tiles (up to 6 across) with a veg/non-veg edge, short code and price; F4 or F2 to search by name or code, Enter adds a single match
- [x] Bill grouped like the kitchen sees it: New items (not sent), To cancel, then KOT 1, KOT 2… with how long ago and a reprint button; reduce a sent item from its KOT row
- [x] Bottom: Tax / Items / Total, KOT and Print bill, then Cash, UPI, Card, Split
- [x] Toolbar under the dishes: Change table, Discount, Service charge, Guest (name, phone, GSTIN)

## Round 5 (October 2026) — `revamp-5`: two-tap safety and the private edition

- [x] Two taps for everything that commits (`ConfirmButton`, `src/lib/two-step.ts`): the first tap turns the button into a clear "tap again" prompt for 4 seconds; a tap elsewhere, Esc or waiting cancels. No pop-ups.
  - Cash / Card settle (shows the amount), Split / panel settle, KOT and cancellation sends (counter and waiter), F8 (press twice) and F1 with items on the bill
  - Guest orders: accept, ready, served, picked up
  - Mark table free, delete dish / table / supplier, record due payment, loyalty points, close counter, record purchase, wastage and stock count
  - UPI with a QR already has its own second step ("Payment received"); cancelling a bill already asks for a reason
- [x] Private edition (`src/lib/edition.ts`, `drizzle/migrations/0007_private_edition.sql`): no plans, trials, plan banners or admin console; strangers can't create restaurants (invite only); the owner's account gets an unlisted Owner plan (50 outlets, 500 staff, never expires); "Business" becomes "Outlets"

## Round 6 (October 2026) — `revamp-6`: admin-only controls, staff login, unblockable sync

**Admin controls.** `src/lib/permissions.ts` is the single list of who may do what; every screen checks `can(user, action)`.
- Owner and manager only: menu and table set-up, stock set-up, purchases and counts, voiding or cancelling bills, large discounts, loyalty points, guest export, all settings, staff, bill series, reports and the dashboard.
- Owner only: resetting a device and managing outlets.
- Cashiers: billing, settling, collecting dues and closing the day (the Reports screen shows them only "Close day").
- Captains: tables, orders and KOTs. Kitchen: tickets and wastage.
- Nobody signed in may do nothing.

**Database enforcement (migration `0008_admin_guards.sql`; run after 0007).**
- Settings, menu, stock materials and suppliers can only be written by an owner or manager.
- A settled or cancelled bill's status, amounts, items, payments and bill number can't be changed or deleted by staff (feedback can still be added).
- Tested on Postgres 16 with owner and cashier sessions.

**Login.** Internal staff login only: email and password, invite-only, no Google button and no "use without signing in". Every staff screen sends a signed-out device to the login page. Sign-in works offline from the last known staff record, so a dropped connection never locks the counter.

**Sync can't get stuck.**
- Before: one change the cloud refused held up every later change on that device.
- Now: refused rows are found one by one and dropped from the queue, and the cloud's copy is restored on the device. The sync window explains what was undone and why.
- Network failures still retry; nothing is lost.
- Covered by sync-simulation tests (cashier menu edit, settled-bill rewrite, offline retry); a mutation check confirms the tests fail on the old behaviour.
