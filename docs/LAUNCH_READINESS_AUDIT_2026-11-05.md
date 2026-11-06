# Launch Readiness Audit — 2026-11-05

Scope: static review of the merged `main` branch after PR #27, plus app entry-point UX changes on `audit/launch-readiness-and-split-login`. This is not a production penetration test or a live-device acceptance run.

## Current disposition

**Not launch-clear yet.** Core offline-first architecture, role checks, database RLS hardening, sync retry logic, and GST workbook tests are present. The most important remaining blockers are the end-to-end paid-bill void approval and live migration/device testing.

## Findings

### P0 — Paid settled-bill void approval is not end-to-end
- Migration 0014 creates server-side TOTP secrets, code display/verification RPCs, and short-lived bill-scoped approval rows.
- The existing closed-bill guard in migration 0008 still allows only owner/manager edits and does not consume the approval rows for a staff void transition.
- No POS prompt, admin-code display surface, reason/audit event integration, or end-to-end test was found in the merged workflow.
- **Impact:** do not rely on the rotating code to authorize staff voids yet. Existing role restrictions remain, but the requested cashier workflow is not complete.
- **Required:** trigger/RPC consumes one unexpired approval atomically for exact restaurant + user + bill UID; restrict transition to settled -> void; require reason; write immutable audit event; rate-limit verification attempts; add RLS/negative tests and POS/Admin UI wiring.

### P1 — Authentication entry point is a combined screen
- `/auth` currently combines app selection and sign-in. This creates an extra decision for installed-app users and makes the app identity less obvious.
- Change in this audit branch: each choice navigates to its own app-scoped URL (`/auth?app=manager`, `/auth?app=pos`, `/auth?app=waiter`) and directly presents that app's sign-in screen. The shared auth service and role checks are retained.
- **Validation still required:** verify installed PWA start URLs/manifest links, deep links, back navigation, and role mismatch handling on desktop + Android.

### P1 — Offline mode and identity cache need operational acceptance tests
- Staff role/profile is cached in localStorage to allow offline startup; business records are in IndexedDB with an outbox and cloud sync retries.
- Offline access necessarily uses the last cached role until the device reconnects. A disabled login or revoked membership cannot be enforced on an offline device until it receives the revocation.
- **Required:** test first sign-in online, offline reopen, reconnection, stale/revoked account, two devices editing the same table, duplicate/reordered sync, failed sync recovery, and browser storage eviction. Document shared-terminal sign-out/lock behavior.

### P1 — Data retention and privacy controls are not yet launch-documented
- Customer records include phone/name and are synced to restaurant cloud records; local POS data persists in IndexedDB and staff identity/role is cached in localStorage.
- No explicit retention schedule, customer-data deletion/anonymization workflow, backup retention statement, or staff-device data wipe acceptance test was identified in this static pass.
- **Required:** define retention by record type (invoice/legal records vs guest marketing/contact data), implement owner/admin export/delete/anonymize controls where lawful, document cloud backup retention, test device reset and logout behavior. Do not delete GST invoice records that must be retained under law.

### P1 — GST reporting is unit-tested, but needs accounting sign-off and edge-case coverage
- GSTR-1 workbook logic and tests cover B2B/B2C, rate buckets, aggregator treatment, cancelled documents, inclusive GST, and XLSX round-trip.
- Reports are generated from synced POS orders; incomplete sync or incorrect order tax metadata can produce incomplete returns. Static review cannot certify current GST portal schema or tax treatment.
- **Required:** reconcile a sample month against bills, day-close, aggregator statements and accountant output; test credit notes/adjustments, mixed rates + discounts + service charge, composition/unregistered mode, cancelled invoice numbering, rounding, date/time boundaries, and missing GSTIN/SAC settings. Accountant must approve before filing.

### P1 — Migration 0014 requires database-level security and runtime verification
- TOTP helper/RPC functions and secret tables are server-side and revoke direct table access from authenticated users.
- Static review identified no verification-attempt throttling or audit trail in the migration. Code acceptance currently checks adjacent time windows; validate clock drift policy and replay behavior.
- **Required:** apply migration to a staging Supabase project; verify function grants, SECURITY DEFINER search paths, role/restaurant scoping, concurrent approval consumption, replay, invalid-code throttling, and that secrets never appear in client responses/logs except the current code to owner/manager.

### P2 — Launch cutoff can reject stale offline records
- Migration 0012 rejects pre-launch order/KOT/stock/day-close records. Sync code treats cloud permission rejection as a record rejection.
- **Risk:** a device holding pre-launch test data can lose that record when syncing after launch. This is intended cleanup behavior but must be made visible and confirmed by operators.
- **Required:** pre-launch device checklist, explicit warning/backup/export, and a staging test proving only intended stale test records are discarded.

### P2 — CI is not equivalent to full launch QA
- CI runs production build and unit tests. Browser regression/live audit suites are separate workflows and depend on configured secrets/environment.
- **Required:** ensure PR checks actually execute (not silently skipped), run live browser tests against staging with seeded test accounts, and capture artifacts for POS, waiter, manager, offline, GST export, and void-control flows.

## Launch acceptance checklist

- [ ] Apply all migrations to staging; verify RLS/grants and rollback/recovery plan.
- [ ] Admin, POS and Waiter each launch directly to their own screen; wrong-role login is rejected.
- [ ] New-device sign-in, password reset, logout, session expiry and disabled-login behavior verified.
- [ ] Cash/UPI settled bill cannot be voided by staff without valid admin code; invalid/expired/replayed code fails; approval is single-use and bill-scoped.
- [ ] Void requires reason, preserves original invoice/payment history, records approver/actor/time, and does not silently restock twice.
- [ ] Offline billing/KOT, offline restart, reconnect/retry, multi-device conflict and stale-role cases pass.
- [ ] GST sample period reconciles to source bills and accountant-approved figures; XLSX opens in Excel/LibreOffice.
- [ ] Retention, customer privacy, backup, device reset and data export procedures are documented and tested.
- [ ] Accessibility/usability pass: tablet/desktop touch targets, keyboard flow, visible sync status, understandable error/recovery messages.
- [ ] CI + staging E2E green; no skipped launch-critical checks; release rollback procedure tested.

## What was actually changed in this branch
- App-selection buttons now open app-specific sign-in URLs, so the selected app is explicit and the login screen is separated by app context.
- No production database was changed and no live/staging tests were run from this connector session.