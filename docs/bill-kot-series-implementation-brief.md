# Bill and KOT numbering implementation brief

## Repository and working branch

- Repository: `boringmanorg/good-times-start`
- Base branch: `main`
- Working branch: `fix/restaurant-wide-bill-kot-series`
- Purpose: preserve the implementation context and acceptance criteria for the TAB Bistro bill/KOT series cleanup and cross-device numbering work.

## Live environment reference

- Lovable project ID: `1af0545d-85c8-432a-9d4a-b2302a6aa07d`
- Restaurant: TAB Bistro by XTSY
- Restaurant ID: `66c66ac4-efce-492b-b709-1c2b38d9cd78`
- Database record store: `public.restaurant_records`
- Inspection date recorded in the prior work: 2026-11-06 (Asia/Kolkata)

The latest live-data inspection on 2026-11-06 found four active held orders, all unpaid, and no active settled orders: the three genuine held bills plus the QAF1 test order. This is a point-in-time snapshot. It also found one QAF1 test order and its linked kitchen tickets. Treat these as a point-in-time snapshot, not a guarantee that the live database remains unchanged. The migration must re-check all assumptions immediately before modifying data.

## Desired numbering state

### Bills

The three genuine held orders must be retained and normalized in chronological order:

| Existing table | Existing bill number | Target bill number |
|---|---|---|
| ROOM-666 | SJT/26-27/0002 | POS/0001 |
| ROOM-10A | SJT/26-27/0003 | POS/0002 |
| ROOM-7A | SJT/26-27/0004 | POS/0003 |

The next newly allocated bill must be **POS/0004**.

### KOTs

KOT numbering is a distinct sequence, independent of bill numbering. The seven genuine KOT submissions identified in the inspection should be normalized chronologically to KOT/0001 through KOT/0007. The next new KOT submission must be **KOT/0008**.

All station slips belonging to one logical KOT submission must share the same KOT number. Group by `submissionId`; for legacy rows without it, use a deterministic fallback based on `orderUid` and `createdAt`.

### QA cleanup

The QAF1 table was used intentionally for live testing. The inspected QA order UID was:

`3f1d03f2-318b-4ebe-8f18-1c7281dab4b2`

The latest live inspection on 2026-11-06 found 10 linked active KOT station rows across 4 submissions (createdAt groups 1793957031061, 1793963923768, 1793964608322, and 1793966740818). This supersedes the earlier 3-submission snapshot. Soft-delete the QAF1 order and all its linked KOT rows from active shared records. Keep the QAF1 table definition, but reset its operational state to free, with running total zero and no active `since` value.

Do not delete unrelated records. Do not hard-delete the QA records; preserve tombstones for sync convergence and auditability.

## Required implementation

1. Inspect the current Supabase schema, RLS policies, migrations, order creation flow, KOT submission flow, local IndexedDB schema and cloud sync behavior before changing code.
2. Add a guarded, idempotent SQL migration for the one-time QA cleanup and normalization.
   - Abort if an active settled order exists.
   - Verify that the expected genuine orders and QAF1 test order still match the inspected identities and expected state.
   - Abort without partial changes if any precondition fails.
   - Use a transaction.
   - Soft-delete only the QAF1 order and linked KOT rows.
   - Update the three genuine bills and their linked KOT bill references.
   - Renumber logical genuine KOT submissions independently and chronologically.
   - Reset QAF1 table state to free.
3. Implement two independent atomic server-side allocators scoped to restaurant:
   - bill sequence allocator;
   - KOT submission sequence allocator.
4. Allocation must be concurrency-safe across terminals, retry-safe/idempotent using a client-generated request key, and protected by appropriate RLS/security-definer checks.
5. Wire allocators into actual order creation, split-bill creation, and KOT submission paths. Avoid local-only counters for official numbers.
6. Offline devices must not invent official bill/KOT numbers that can collide. Defer official allocation until connectivity is restored; clearly represent pending/unallocated state and ensure pending records cannot be printed or treated as finalized numbered tickets until allocated.
7. Sync must propagate canonical server-issued numbers to every device. A stale local outbox row must not overwrite a newer canonical number or resurrect tombstoned QAF records.
8. Ensure all KOT station slips in one submission share the allocated KOT number.
9. Update types and generated Supabase schema types as required.
10. Add tests for chronology, independent counters, concurrent allocation, retry idempotency, multi-station KOT grouping, offline behavior, tombstone handling, and migration precondition failures.
11. Run relevant unit tests, type checks, lint and production build. Record actual command results.

## Safety and deployment boundaries

- No production database changes have been applied as part of the prior work.
- Do not claim the QA cleanup or numbering normalization is complete until the migration is explicitly applied and verification queries confirm the result.
- Keep the migration in source control and have it reviewed before applying to production.
- Do not reset or clear all local IndexedDB data as a workaround.
- Do not modify settled bills or financial/payment history.
- If live data has changed since the original inspection, stop and reconcile the migration preconditions rather than forcing the original mapping.

## Acceptance criteria

- Active QAF1 test order and all its linked KOT records are tombstoned; no unrelated records are affected.
- The three genuine held bills are POS/0001, POS/0002 and POS/0003 in chronological order.
- The next bill allocation is POS/0004.
- Seven genuine KOT submissions are KOT/0001 through KOT/0007 in chronological order.
- The next KOT allocation is KOT/0008.
- Bill and KOT counters advance independently.
- Concurrent requests from multiple devices cannot receive duplicate numbers.
- Repeated request keys return the same allocation.
- All terminals converge on the same canonical bill/KOT identifiers.
- Tests and build pass, with results documented in the pull request.


## Latest preflight refresh (2026-11-06)

The Lovable project's connected Supabase database was queried directly. The restaurant ID resolves to TAB Bistro by XTSY. Current active state at inspection:

- Active orders: 4; held: 4; settled: 0.
- Genuine held orders remain the three expected identities and bill numbers.
- QAF1 order remains held, unpaid, with bill D1/26-27/0010.
- Active KOT rows: 24 total; genuine: 14 rows across 7 logical submissions; QAF1: 10 rows across 4 logical submissions.
- QAF1 table remains billed with running total ₹3,119 and a populated since value.
- QAF1's 4 submission timestamps are 1793957031061, 1793963923768, 1793964608322 and 1793966740818.

The updated guarded cleanup migration must require exactly these counts and identities. Do not execute the cleanup until the application allocator change is deployed, and re-run the same preflight immediately before applying it.
