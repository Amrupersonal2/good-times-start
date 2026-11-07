<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Use the app-only BillPrintButton for saved-bill controls to share authorization and designated-counter routing; keep it out of the consumer-safe library barrel because it depends on staff sessions and POS records.

- Keep Orders in a fixed-height dialog with stationary filters and an internally scrolling list; render history previews within their selected row so opening receipts does not resize or recenter the window.

- Before retrying queued settlements, durably remove only valid zero tenders when retained payments still equal the total; preserve all bill identities, amounts and atomic units, acknowledge unrelated successful units even when another fails, and close NC bills with an empty payment array rather than a fictitious cash receipt.

- Keep guest reservations in a separate RLS-protected arrival ledger with public availability-only RPCs, token-scoped guest status and member-authorized transitions; upcoming accepted bookings annotate floor/Orders, explicit Start order prepares only a guarded local guest draft, and one root notifier sounds on newly observed requests after browser audio unlock. Never create bills, settlements or KOTs implicitly.

- Keep IndexedDB as the offline source of truth and mirror signed-in users' orders and stock to Lovable Cloud, so sales continue during network outages.
- Keep durable active-order drafts and sync health metadata in IndexedDB; only use cloud sync as a signed-in mirror so checkout and kitchen service remain available offline.
- Reserve official POS/KOT numbers through the existing member-authorized allocator while connected; consume reservations atomically in IndexedDB, retain their cloud request identity on records, and never renumber them on reconnect or invent a number after reserve exhaustion.
- Owner's choice (7 Nov 2026): strict POS/KOT sequence over offline numbering. Bills and KOTs take the next cloud number directly; NUMBER_RESERVE_TARGET is 0 because spares come from the same counter and make numbers skip. Offline, orders and drafts still save, but settling, first bill print and sending KOTs wait for the internet.
- Running bills have an empty billNo; the official POS number is allocated (bill uid as request key) at settlement or first bill print via bill-numbering.ts and stamped on that bill's KOTs, so settled bills run in settlement order. Split parts are numbered when settled. The server guard (docs/migrations/2026-11-07-number-bills-at-settlement.sql) accepts unnumbered held/void bills and refuses settled bills without an allocated number.
- Orders → History has KOTs, Settled (with All/Cash/UPI/Card & other filter), NC (settled with no payment) and Cancelled, each listed on the day it closed; running bills stay in the Running tab. Table reservations and QR order history live in the header Bookings dialog, not in Orders.
- Guest QR orders carry a server-assigned QR series number (guest_orders.qr_no → QR/0001, applied to Lovable Cloud 7 Nov 2026; docs/migrations/2026-11-07-guest-order-qr-series.sql); a QR bill shows its qrNo until settlement gives it a POS number.
- The guest QR page offers only dining tables (guestTableChoices hides the Rooms section; a scanned room's own QR still works), and seated table guests go straight to the menu without the reservation button.
- Spare-number caches use the `reservedNumbers:v3:` key so pre-reset reserves are abandoned; a bill or KOT the cloud refuses as unallocated gets a fresh cloud number (old number kept as printedBillNo/printedKotNo) instead of being dropped.
- iOS standalone apps use viewport-fit=cover with a translucent status bar: top bars must pad by env(safe-area-inset-top).
- Counter numbering resets require an owner-validated cloud RPC with collision checks; sync maps the original counter series into IndexedDB before pushing, while checkout allocates locally above existing invoice numbers to preserve offline service.
- Put authenticated AI Gateway calls in client-importable `*.functions.ts` RPC wrappers with server-side authorization and server-only helpers, keeping gateway secrets and prompts out of browser code.
- Sales/menu AI analysis requires owner membership in the submitted restaurant and sends only reviewed aggregates; recommendations never mutate menu or order records.
- Generate guest QR links from the canonical public origin in qr-ordering.ts, never the current editor origin, so printed cards remain usable outside preview.
- Restore guest carts before enabling persistence and treat order placement success independently of optional marketing recording, so refresh and secondary failures cannot lose carts or invite duplicate orders.
- Resolve app installation identity with app-install-logic and exclude app workers from development and editor hosts; this prevents stale preview assets.
- Keep library component extraction pointed at src/index.ts and export documented public controls there, so the published catalog matches the consumer entry point.
- Dialog and Popover wrappers in src/components/ui render nothing while closed and force-mount while open, so no Radix Presence runs for closed overlays; Presence open/close tracking caused React 19 "Maximum update depth exceeded" blank screens.
- Restore merged GitHub changes selectively without replacing generated Cloud configuration or local numbering protections; apply database safeguards through managed migrations so the preview and Cloud stay consistent.
- Keep KOT end-feed in the shared slip model and use it for browser and ESC/POS output; printer-driver paper length and cutter offsets remain device-controlled.
- Treat cloud order mirrors as data only, never print commands; explicit browser jobs always call window.print(), with kiosk/dialog behavior controlled by Chrome rather than a readiness checkbox.
- Route explicit waiter print commands through a durable local outbox and authenticated, designated-counter claim queue; do not replay ambiguous claimed dispatches, because physical printing cannot be acknowledged by browsers.
- Separate Business Manager from tables and thermal printing while keeping report exports, because administration does not own the counter printer.
- Keep Orders history in indexed local bill/KOT reads and preserve guest acceptance separately; hide aggregator entry until an actual order-sync integration exists, retaining historical order types.
- Create floor sections together with their first table through the existing table save/sync path, so section creation works offline without a parallel registry.
- Persist KOT submission identity and device/day sequence atomically with station tickets; history groups submissions while keeping every station record for printing and sync.
- Snapshot table sections on orders and KOTs so printed history survives floor edits.
- Record settlement time and receiving device on bills; cash closes bind to durable device identity and never settle hotel room bills implicitly.

- Restaurant record writes go through the versioned `push_restaurant_records` RPC (server-owned `version`, stale-write conflicts, settlement units committed atomically) with automatic fallback to the legacy upsert when the RPC is absent, so builds can ship before the migration is applied.
- Keep the generated Cloud `.env` (publishable keys only) tracked, never gitignored: published builds read it, and removing it blanks the live site.
- Redirect empty billing entry in route beforeLoad before mounting cart hooks; preload only core operational screens after sign-in so startup never waits on unused billing or report resources.
- Reconcile stale occupied floor tiles against closed bills for display only, preserving open bills, device holds and new unsent drafts; never rewrite financial records to repair occupancy.
- Keep the kitchen screen read-only over indexed local KOTs and existing cloud mirroring; live hotel tickets remain visible across days, settlement summaries use payment timestamps, and invoice dates remain unchanged.
- Derive floor counts from indexed local floor, accepted bookings and payment-day reads; pending reservations remain in header notifications, allotted guest entries stay nonfinancial until explicit order submission, and KOT presentation stays in Orders.
- Orders KOT reprints use the shared PrintHost dispatch and existing reprint authorization; never create new tickets or numbers when printing saved history.
- Carry reservation identity from guest drafts into counter bills; cancellation queues exact-booking cleanup in IndexedDB and masks stale annotations until authorized Cloud status reads back, preserving later reservations and financial history.
- Enforce guest self-cancellation deadlines in the token-scoped database RPC and mirror the deadline in guest controls; kitchen-accepted orders remain staff-managed to avoid orphaning financial/KOT records.
