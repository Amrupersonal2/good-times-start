# POS expansion

## Orders window
- [ ] Hide unconnected aggregator entry buttons; keep historical bills.
- [ ] Default to running bills; add dated bill/KOT/settled/cancelled history and preserve guest acceptance.
- [ ] Verify history filters and running-bill opening.

## Device-local thermal printing
- [x] Block incoming-order printing and unconfigured browser print dialogs; preserve local direct transports.
- [x] Standardize thermal typography and preserve per-device 58/80 mm choices.
- [x] Verify local print dispatch and no print jobs on a second signed-in device at both paper widths (16 tests passed).
- [ ] Verify physical silent output; requires the printer device launched with the silent Chrome shortcut or configured RawBT.

## Restore merged GitHub fixes (#24–33)
- [x] Restore missing merged code and CI changes; exclude unmerged #34 and preserve numbering.
- [x] Apply membership and paid-bill approval safeguards to Lovable Cloud.
- [x] Run regression tests and signed-in preview checks (238 tests; Sync close/Escape/outside and sign-in links).

## Counter bill numbering
- [ ] Add owner-authorized reset with collision protection and durable counter series metadata.
- [ ] Rename the retained bill and linked references to TBX/26-27/0001; next number 0002.
- [ ] Run numbering, permission and sync tests; verify the owner reset through the screen.

## Live app completion
- [ ] Finish guest table selection and verify checkout reaches the signed-in POS and another device.
- [ ] Add GSTR-1 and sales exports to the standalone live reports app.
- [ ] Correct reports install identity while preserving counter and waiter install identities.
- [ ] Run mobile/tablet/desktop checks and sales, guest-order, and sync regression tests.

## QR ordering refresh
- [ ] Modernize the guest menu with category browsing, search, dietary filters, and clear table context.
- [ ] Repair cart restoration and submission recovery without changing offline POS storage.
- [ ] Add QR readiness checks, live-site links, individual table QR downloads, and admin access to branding.
- [ ] Verify guest ordering, saved admin settings, regression tests, and preview build.

## Owner sales and menu advisor
- [ ] Add editable sales/menu input and a current-period POS summary in Insights.
- [ ] Add owner-authorized AI Gateway analysis with safe failure handling.
- [ ] Test data filtering, validation, permissions, and signed-in analysis.

- [ ] Add secure staff sign-in and session-aware account controls.
- [ ] Add offline held bills and quantity-based bill splitting.
- [ ] Add tracked menu stock, low-stock alerts, and settle-time deduction.
- [ ] Sync signed-in orders and inventory with Lovable Cloud.
- [ ] Build table-first live ordering with editable item selection and cart beside it.
- [ ] Send and print station-routed KOTs before bill printing and settlement.
- [ ] Add manager sync status, actionable errors, and AI-assisted diagnosis.
- [ ] Verify sign-in, table ordering, KOT-before-bill, sync recovery, and current build.