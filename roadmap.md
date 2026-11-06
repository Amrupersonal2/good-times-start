# POS expansion

## Wireless waiter printing
- [ ] Queue explicit waiter KOT/bill requests for a designated connected POS device; preserve offline requests and avoid peer printing.
- [ ] Remove Business Manager tables and thermal-printer access while preserving report printing.
- [ ] Test routing and access rules, publish, and verify the live counter flow; physical output requires the connected printer.

## Hotel counter corrections
- [x] Count KOT submissions rather than station tickets; add independent daily device-safe KOT numbering and table/section print context.
- [x] Add guest-only QR requests entry under Counter orders; preserve POS/waiter acceptance and admin-only controls.
- [x] Remove builder cleanup diagnostics from staff Sync screens.
- [x] Add Hotel declaration, stable device-bound Cash Counter, settled-day close accounting and dated close history.
- [ ] Complete published end-to-end verification after deployment: publishing scheduled, but fresh live check still serves the previous controls. Preview Reception Orders/QR/Cash Counter verified with zero runtime errors; 252 tests pass. No test sale or cash-close record created.
- [x] Review completed security findings and verify existing staff access without broadening privileged roles; Reception and Waiter already active. Basic checks clear; deep scan retains the owner/manager campaign-recipient warning.

## Counter rollout and floor creation
- [x] Add direct Add section / Add table forms; verified create, refresh, second table and test-table cleanup under owner session.
- [ ] Connect real Swiggy/Zomato orders; blocked pending approved partner API access and documentation.
- [ ] Publishing requested; current preview opens Room 666 and safely gates unconfigured KOT printing (24 tests passed). Published end-to-end check awaits deployment: live check still showed older controls.
- [ ] Check actual 2-inch thermal paper; requires access to the user's counter printer.
- [ ] Complete security clearance; remaining campaign-recipient warning needs a decision on restricting owner/manager sends to saved opted-in guests.

## Orders window
- [x] Hide unconnected aggregator entry buttons; keep historical bills.
- [x] Default to running bills; add dated bill/KOT/settled/cancelled history and preserve guest acceptance.
- [x] Verify history filters and running-bill opening (3 tests and signed-in preview).

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