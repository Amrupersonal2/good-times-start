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
