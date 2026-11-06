# Database load tests

Runs the real migrations on a local Postgres 16 with Supabase-style roles, loads
50 outlets × the full TAB Bistro menu (131 dishes) × 100 tables, then measures
the guest-facing database functions under load.

```sh
createdb load
psql -d load -f tests/load/supabase-stub.sql
psql -d load -f drizzle/migrations/0005_restaurant_team_sharing.sql
psql -d load -f drizzle/migrations/0006_outlets_plans_guest_ordering.sql
bun tests/load/seed-menu.ts 50 | psql -d load
pgbench -n -d load -f tests/load/storefront.sql -c 50 -j 4 -T 20   # guests opening the menu
pgbench -n -d load -f tests/load/order.sql -c 20 -j 4 -t 50        # guests placing orders
```

Results, 18 Oct 2026, 2-core cloud machine:

| Test | Result |
| --- | --- |
| Menu page, 1 phone | 4.4 ms per load |
| Menu page, 50 phones at once for 20 s | 9,154 loads, 457/s, 109 ms average, 0 errors |
| Guest orders, 20 phones × 50 orders | 1,000 orders, 1,744/s, 11 ms average, 0 errors |
| 30 counters accept the same order at once | exactly 1 succeeds |
| 60 orders to one outlet in a minute | stops at the 40-a-minute limit |

App-side load and regression tests run with the unit tests (`src/test/load.test.ts`,
`src/test/sync-simulation.test.ts`, `src/test/performance.test.ts`).
