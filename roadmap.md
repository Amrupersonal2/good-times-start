# POS expansion

## Live table status board
- [x] Simplify Tables to prominent inline counts; include all Room/Dine-in running bills under Counter orders and nonfinancial allotted-guest entries, remove Active KOTs and standalone booking sections, and move acceptance/decline into a top-bar notification panel before Orders. Pending requests never annotate the floor, even after arrival; accepted guests appear on tables without implicit financial records. Thirty tests and isolated desktop/tablet/phone checks pass, no overflow/runtime errors or production writes. Public guest status stays pending until allotment. Not published.
- [x] Add booked, settled-today, occupied and free floor filters plus read-only active KOTs from indexed local records; preserve holds, reservations and existing offline sync. Eight board-rule tests plus existing floor/reservation/submission suites pass.
- [x] Hide the separate Kitchen entry and redirect its old URL to Tables until confirmed. Isolated signed-in counter checks verify payment-day settlements and active KOT removal on settlement without refresh; desktop/tablet/phone show no overflow or runtime errors. Automatic build OK. No production writes; real cross-device sync and publication not performed this turn.

## Public guest reservations
- [x] Accepted upcoming bookings now annotate Tables immediately, appear in Orders → Bookings and carry guest details through explicit Start order into a local draft. Guard existing running bills/other guests' drafts. One root notifier chimes and shows a new-request toast after browser sound activation; Enable sound provides a device test. 30 tests pass, automatic build OK, isolated signed-in flow verified table reservation, Orders entry, three sound tones and guest-filled cart with no page errors or production writes. Publishing not requested; physical speaker and waiter-role checks remain unverified.
- [x] Add public QR arrival bookings, occupancy-only public data, token-scoped guest status, staff confirmation and serialized overlapping-slot protection; additive migration applied without creating bookings.
- [x] Show dated arrivals beside floor occupancy and kitchen/settled-room history; active slots mark free tables reserved for display only. Add waiter reservation controls and admin QR download.
- [x] Cache staff arrivals in IndexedDB and refresh on reconnect; preserve guest draft/request identity across refresh. 25 targeted tests and automatic build pass; public mobile availability/validation has no page errors or overflow. Isolated staff confirmation reads back and appears in kitchen/settled view, with saved arrivals retained offline.
- [x] Publish and verify the live public QR: HTTP 200, real authorized TEST BOOKING for Bonfire 1, two guests, November 7 at 14:21 IST; reservation e65874fa-7daf-4dad-8dc1-4d768938e77a confirmed at counter and visible on Kitchen after 3.23 seconds and alongside Settled rooms. Guest confirmation survives reload, with no page errors. Test reservation remains confirmed; no bill or KOT created. Basic security checks and 25 tests pass.
- [ ] Waiter-specific sign-in and physical QR scanning remain unverified: injected Reception cannot access waiter mode; no physical camera/device available.

## Offline official numbering
- [x] Cache 20 cloud-reserved POS and 20 KOT numbers on operational devices; consume atomically offline and retain original cloud reservation IDs without renumbering printed tickets.
- [x] Verify retry, exhaustion and concurrent consumption in tests; signed-in preview counter created a Milk Chai KOT offline and a second Kitchen received its unchanged number through an isolated cloud mirror after reconnect. 331 tests and automatic build passed; no production records or sequences changed.
- [ ] Publish and verify real counter-to-kitchen reconnect: awaits an explicit publish request; physical printing remains unverified. Multi-device chronological gaplessness is not promised because reserved blocks prevent collisions.

## Kitchen view and settlement dates
- [x] Add a separate live kitchen screen with grouped station KOTs, cancellation slips and rooms settled on the selected day.
- [x] Align POS settled history, hourly sales and report date displays/exports with settlement timestamps; retain invoice creation dates.
- [x] Verify signed-in Reception kitchen/history views on desktop and tablet with production writes blocked; 37 targeted tests and automatic build passed. Kitchen-role device sign-in remains unverified; publishing not requested.

## November 7 startup and deep release audit
- [x] Repair the reproducible blank homepage without changing restaurant data; verified signed-out and signed-in entry.
- [x] Run existing unit/sync/printing checks: 317 tests across 58 files, typecheck and automatic build passed; release gaps recorded in docs/DEEP_RELEASE_AUDIT_2026-11-07.md.
- [x] Implement the audit's Windows browser print-dialog fallback without enabling peer printing; both readiness states dispatch once in tests.
- [x] Publish the loading repair; live root returns 307 to Tables, existing Room 10A bill and Orders load with no page errors and all restaurant writes blocked.
- [ ] Harden unresolved sync contract fallback, crash-atomic conflict decisions and uncertain printer claims; requires reviewed changes and disposable database/browser regression, not production experiments.
- [ ] Complete Lighthouse/React profiles, real IndexedDB quota/upgrade/cross-tab tests, installed-worker deployment recovery and full authorized Manager/Waiter E2E; current evidence is limited to automated browser entry checks and mocked sync tests.
- [ ] Native Android packages and physical printing validation: blocked by signing credentials, device/printer access, and native packaging outside the supported web stack.

## Wireless waiter printing
- [x] Queue explicit waiter KOT/bill requests for a designated connected POS device; preserve offline requests and avoid peer printing.
- [x] Remove Business Manager tables and thermal-printer access while preserving report printing.
- [x] Test routing and access rules: 260 regression tests pass; signed-in manager gates and retained waiter Room 7A bill-print request verified without runtime errors.
- [ ] Publishing requested; fresh live counter opened Room 7A and reports without errors, but still served previous printer/manager controls. New deployed routing needs verification after rollout. Real counter must save silent printer setup and select Receive waiter printing here; physical output remains unverified. No bill settled or test sale added.

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
## Room 666 KOT recovery and guests
- [x] KOT button now sends exactly the items shown as "not sent" (bill counter could be ahead of saved tickets, so KOT sent nothing).
- [x] Tickets synced before their bill now link to it on every device, so sent items never show as unsent.
- [x] Recorded Room 666 waters in history: KOT/0012 (4) and KOT/0013 (2, printed earlier).
- [x] Guests list fills from names on running and settled bills; WhatsApp allows guests whose consent staff recorded.
- [x] Exported live menu (131 items, 23 sections) for corrections.
- [ ] Apply the owner's menu corrections once returned.
