/**
 * Private edition: XTSY POS runs for one owner (TAB Bistro by XTSY and its
 * outlets), not as public software. With this on:
 * - no plans, trials, plan banners or admin console;
 * - a stranger who signs up can't create their own restaurant; staff use the three internal logins (admin, billdesk, waiter);
 * - the Business page shows outlets and sales only.
 * Set to false (and run the database change in drizzle/migrations/0007) to sell it to other restaurants.
 */
export const PRIVATE_EDITION = true;
