# XTSY POS — startup repair and deep release audit

Date: 7 November 2026 UTC. Live software: https://good-times-start.lovable.app.
This is a completed startup repair, source/contract audit and automated test pass, **not** a complete performance certification or Android release.

## Safety and revision baseline

- Local starting revision: `3e0c8805ed11c3b2b222bad5a8365fccafef3ecb` on Lovable-managed edit branch `edit/edt-dc04e05c-0303-4a00-9304-d7b99e623e08`.
- GitHub main read through Amrudheen's GitHub API (1): `97f5df06f233497e51c05e5ae690939a1f7ffe4c`, whose parent is the local starting revision. Its commit is a design-system publication. No branch replacement, direct GitHub commit, force push, PR merge or PR reopening was performed.
- PR #51 verified `closed`, `merged_at: null`; remains untouched. Its print fallback was implemented independently in the current Lovable source.
- No production restaurant records or schemas were deliberately written. Browser checks blocked non-GET restaurant REST requests and returned null for printer claims. No checkout, KOT submission, print, guest order or cash close was executed. Local test browser storage is disposable.
- Generated Cloud clients and tracked `.env` were preserved. Locally present configuration alone is not proof of an earlier deployment's configuration.

## Reproduced startup fault and deployed repair

Before repair, a fresh browser visiting `/` committed navigation but repeatedly failed to read page content; `/tables?app=pos` reached sign-in, and a restored Reception session loaded Tables. This distinguishes a root billing-entry problem from DNS or a wholly unavailable service.

The empty root entry previously mounted the entire billing/cart subtree and tried to navigate from an effect. The repair resolves empty entry in route `beforeLoad`, before cart hooks/render resources mount. Explicit `table`, `bill`, and valid counter `type` remain bill entries. Explicit Manager/Waiter identities retain their own destinations. Background preloading now waits for sign-in and limits itself to core operational screens rather than immediately fetching reports/marketing/unused billing.

The precise underlying render/resource deadlock was not isolated to a single instruction; eliminating the unnecessary billing mount resolved the same reproduction. No claim is made that all possible blank-screen causes are fixed.

After deployment:

- `curl` to live `/` returned **HTTP 307**, `Location: /tables?app=pos` (previously HTTP 200 billing shell).
- Fresh signed-out desktop/mobile entry links for POS, Manager and Waiter reached sign-in with no page exceptions and no horizontal overflow.
- Restored Reception session opened the live homepage, Tables, Orders and existing Room 10A **POS/0002**, ₹1,533, with KOT/0004 and KOT/0006 visible; **zero page errors**. No financial action performed.
- Reception was correctly refused Manager/Waiter access. This is an access-denial check, not an authorized Manager/Waiter full-flow pass.
- One signed-in fresh-browser homepage-to-loaded-table run was **3.8 seconds** on the sandbox network. This includes loading existing records, is one sample, and is not a Core Web Vitals claim.

## Exact checks and results

| Check | Command/evidence | Result |
|---|---|---|
| All unit tests | `bunx vitest run` | **317 passed, 58 files**, 25.58 s |
| Targeted baseline | `bunx vitest run src/test/app-routing.test.tsx src/lib/restaurant-numbering.test.ts src/test/concurrency.test.ts src/test/sync-simulation.test.ts src/lib/counter-print.test.ts src/lib/print-logic.test.ts src/lib/print-routing.test.ts` | 53 passed before new regressions |
| TypeScript | `bunx --package @typescript/native-preview tsgo -b --noEmit` | Exit 0 |
| Production build | Lovable automatic build log `/tmp/observability/build-errors.log`, 05:18:38 and 05:19:44 UTC | `build OK`; no manual `bun run build` run |
| Root live response | `curl -sS -D /tmp/browser/startup-audit/deployed-headers.txt https://good-times-start.lovable.app/ -o /tmp/browser/startup-audit/deployed-root.html` | 307 to Tables |
| Signed-in read-only UI | `python3 -u /tmp/browser/startup-audit/verify_counter.py` | Homepage, Orders and existing bill loaded, zero page exceptions |
| Desktop/mobile entry measurements | `python3 -u /tmp/browser/startup-audit/measure_entry.py` | Six fresh-context entry checks; zero page exceptions/overflow |
| Lighthouse attempt | `bunx --package @lighthouse/cli lighthouse --version` | Failed: package 404; Lighthouse **not run** |
| CPU profile attempt | `python3 -u /tmp/browser/startup-audit/root_profile.py` | Profiler stop timed out on frozen old root; no usable profile |
| Hardware / installed-copy upgrade | Not accessible | **Unverified** |

The unit load suite simulates seven devices/1,050 bills and fresh-device/4,000-record sync using fakes. It does not certify real IndexedDB quota/migrations or production concurrent settlement.

## Entry measurements — raw observed samples

Headless Chromium, sandbox network, fresh contexts, no CPU/network throttling. Desktop 1280×1800; phone-sized 390×844. One sample per route/size. Values describe the initial HTML navigation, which may redirect to sign-in. The visible-login measurement includes a deliberate one-second observation wait. No LCP/INP/CLS or real Android performance claims.

| View | Requested entry | TTFB ms | DOM ready ms | FCP ms |
|---|---|---:|---:|---:|
| Desktop | `/` | 126.8 | 486.4 | 504 |
| Desktop | `/manager?app=manager` | 743.3 | 907.4 | 920 |
| Desktop | `/waiter?app=waiter` | 687.4 | 828.6 | 840 |
| Phone-sized | `/` | 139.7 | 1027.2 | 1036 |
| Phone-sized | `/manager?app=manager` | 86.9 | 204.9 | 212 |
| Phone-sized | `/waiter?app=waiter` | 532.3 | 665.7 | 684 |

Before repair, root content-read exceeded an eight-second bounded check; after repair entry is interactive. That is bounded functional evidence, not comparable before/after Web Vitals.

## Applied changes

- `src/routes/index.tsx`: pre-render empty-entry redirect, preserve explicit billing entries.
- `src/components/PreloadScreens.tsx`: authenticated core-screen preloads only.
- `src/components/PrintHost.tsx`: remove all silent-readiness blocking/clearing for local bills, KOTs, shared browser rendering and designated-counter claims. Chrome decides kiosk versus dialog behavior. Incoming mirrors still never print; Waiter routes to counter; Manager remains blocked.
- `src/components/PrinterMethod.tsx`: explain silent shortcut and normal dialog fallback.
- `src/routes/settings.tsx`: counter designation no longer disabled by advisory readiness flag.
- `src/components/PrintHost.test.tsx`: window.print once in both readiness states; afterprint does not replay.
- `src/test/app-routing.test.tsx`: empty-entry identity redirects plus explicit table/bill/takeaway preservation.
- `AGENTS.md`, `roadmap.md`, this report: contract and release evidence.

## Severity-ranked unresolved conflict register

| Severity | Location | Evidence/root cause | Safe next acceptance |
|---|---|---|---|
| High | `cloud-sync.ts` pushVersioned | Missing RPC **and malformed result** can downgrade to legacy upsert, losing CAS guarantees | Reject malformed contracts; retain outbox and surface migration mismatch. Preserve documented legacy rollout intentionally; test disposable server |
| High | `cloud-sync.ts` conflict resolution | Durable conflict removed before requeue/remote restore; crash can lose review workflow | Atomic durable decision intent + record/outbox work; interrupt every step, no blind local/cloud choice |
| High | `PrintHost.tsx`, migration 0010 | Claims do not expire/recover; finish is sent after scheduling, before browser print actually starts; pending docs assignment can replace jobs | Explicit uncertain/attempted states, visible reviewed recovery; never auto-replay ambiguous physical output |
| High | migration 0022 / live `bill_payments` | Live has no noninternal bill_payments triggers; records trigger list lacks 0022 validation/immutable-KOT trigger additions | Review full migration parity/historical invariant counts on disposable upgrade fixture; do not apply during audit |
| Medium | `auth-context.tsx` | getSession and auth-event resolveStaff not consistently bounded; cached roles help but stalled work may retain loading | Bounded cancellation-safe initialization, identity-change race tests, offline role enforcement |
| High | `public/sw.js`, `AppInstall.tsx` | Hand-written cache worker, broad cache deletion, eagerly activated updates, partial precache; old installed copies not exercised | Migrate using guarded vite-plugin-pwa or skill cleanup path with scoped cache preservation; test old-tab deploy + offline startup; no ad-hoc worker hacks |
| High | CI/regression workflow | Browser tests conditionally skip; workflow success can mean no authenticated E2E | Release gate marks missing credentials BLOCKED, frozen deps, artifacts and isolated-data flows |
| Medium | Native Android delivery | No Capacitor/Gradle/build/signing pipeline present | Separate approved native delivery path and protected signing credentials; real POS/Manager/Waiter installs/updates/printer tests |

## Live read-only database contract inventory

Confirmed `restaurant_records.version` bigint and callable signatures for `push_restaurant_records(uuid,jsonb)`, numbering allocator and enqueue/claim/finish counter printer RPCs. Versioned push is security-invoker, checks authenticated restaurant membership, locks records, refuses stale differing payloads, uses atomic unit exception scopes and inserts idempotent payments into `bill_payments`. Counter RPCs are security-definer with fixed search paths. Records have member-scoped SELECT/INSERT/UPDATE policies with admin restrictions on setup/menu/material/supplier writes; print job status SELECT is limited to requesters/member access.

Confirmed record triggers: canonical number, KOT dedupe, launch cutoff, numbering guard, closed-bill protection, touch and version bump. This is contract inventory, **not** SQL race/RLS attack testing or proof of all migration parity. No migration applied.

## Printing and release limits

Shared slip source contains bill bottom **30 mm**, KOT top **30 mm**, KOT bottom **10 mm**. Existing grouping/cancellation/slip tests pass. Physical feed, driver cutter offsets, default printer and kiosk operation remain unverified. Browser checkbox cannot detect Chrome kiosk mode or acknowledge paper output. No new footer wording was provided by this brief, so none was invented.

No APK, AAB, native build, signature or checksum was produced. Native Android packaging is outside this supported web project workflow and requires a separate build environment, signing credentials, device/printer models and physical tests. Three entry identities/manifests remain preserved. Do not advertise verified Android binaries.

## Deployment / rollback runbook

Frontend loading/print fallback deployed through Lovable and read-only live verification passed. No SQL or native rollout required for these changes. Keep generated Cloud settings tracked. If frontend regression appears, restore the prior known-good frontend snapshot via managed history and republish; do not restore database backups or renumber bills for a UI rollback. Worker cleanup/replacement needs its own guarded, scoped release and installed-copy testing. Any future DB safety migration must first pass clean/legacy disposable fixtures and an explicit review; append corrective migrations, never destructively rewrite business history. Native rollback requires signed versioned artifacts and local-data-compatible upgrades.

Recent GitHub CI reports main success, and closed PR #51 CI/regression success; the latter does not mean merged code or verified authenticated E2E. Full authorized Manager/Waiter workflows, Lighthouse/React/bundle profiles, real-browser durability, deep security clearance, APK delivery and hardware printing remain **NOT VERIFIED / BLOCKED**, not passed.