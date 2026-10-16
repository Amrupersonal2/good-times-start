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
- [ ] Split payments and split bills, UPI QR on screen
- [ ] Void/cancel with reason and manager approval, reprint
- [ ] Service charge, discount limits by role, customer phone on bill

### Phase 4 — Kitchen & captain
- [ ] Kitchen display tuned for wall screens, KOT reprint/cancel
- [ ] Captain (waiter) mobile ordering

### Phase 5 — Inventory & purchase
- [ ] Raw materials, recipes, auto-deduction, purchases, suppliers, wastage

### Phase 6 — Customers
- [ ] Customer directory, visit history, loyalty points, feedback

### Phase 7 — Reports
- [ ] Day-end and shift close, cash drawer, GST report, item/category/staff
      sales, date ranges, export

### Phase 8 — SaaS
- [ ] Onboarding wizard, multiple outlets, subscription plans, admin console
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
- Realtime notifications on `restaurant_records` trigger a pull so other devices
  see new KOTs and table changes within seconds.
