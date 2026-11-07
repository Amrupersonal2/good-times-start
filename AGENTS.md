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

- Keep guest reservations in a separate RLS-protected arrival ledger with public availability-only RPCs, token-scoped guest status and member-authorized transitions; upcoming accepted bookings annotate floor/Orders, explicit Start order prepares only a guarded local guest draft, and one root notifier sounds on newly observed requests after browser audio unlock. Never create bills, settlements or KOTs implicitly.

- Keep IndexedDB as the offline source of truth and mirror signed-in users' orders and stock to Lovable Cloud, so sales continue during network outages.
- Keep durable active-order drafts and sync health metadata in IndexedDB; only use cloud sync as a signed-in mirror so checkout and kitchen service remain available offline.
- Reserve official POS/KOT numbers through the existing member-authorized allocator while connected; consume reservations atomically in IndexedDB, retain their cloud request identity on records, and never renumber them on reconnect or invent a number after reserve exhaustion.
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
