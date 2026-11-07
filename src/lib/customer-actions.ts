import { getDb, markDirty } from "./db";
import { normalisePhone } from "./customer-logic";
import { newUid } from "./sync-core";
import type { Customer, Order, PaymentMode } from "./types";

/** Add or update a guest from a bill. Returns the customer, or null when there's no usable phone number. */
export async function rememberCustomer(details: { name?: string; phone?: string } | undefined): Promise<Customer | null> {
  const id = normalisePhone(details?.phone);
  if (!id) return null;
  const db = getDb();
  const existing = await db.customers.get(id);
  const name = details?.name?.trim();
  if (existing && (!name || name === existing.name)) return existing;
  const customer: Customer = { ...(existing ?? { id, phone: id, createdAt: Date.now() }), ...(name ? { name } : {}) };
  await db.customers.put(customer);
  await markDirty(["customer", id]);
  return customer;
}

/**
 * Save every guest named on a bill — running or settled — who isn't on the Guests list
 * yet, so guests staying on open room bills show up before they pay. Returns how many were added.
 */
export async function rememberGuestsFromBills(): Promise<number> {
  const db = getDb();
  const orders = await db.orders.filter((o) => (o.status === "held" || o.status === "settled") && !!normalisePhone(o.customer?.phone)).toArray();
  let added = 0;
  for (const o of orders) {
    const id = normalisePhone(o.customer?.phone);
    if (!id) continue;
    const before = await db.customers.get(id);
    if (before && (before.name || !o.customer?.name?.trim())) continue;
    if (await rememberCustomer(o.customer)) added += before ? 0 : 1;
  }
  return added;
}

export async function updateCustomer(customer: Customer): Promise<void> {
  const db = getDb();
  const before = await db.customers.get(customer.id);
  await db.customers.put(customer);
  const renamed = await renameOnRunningBills(customer, before?.name);
  // Bills push at once and reach every terminal live; the guest record follows in the same push.
  await markDirty(["customer", customer.id], ...renamed.map((uid): ["order", string] => ["order", uid]));
}

/** A renamed guest's running bills take the new name, so every terminal's bill and floor show it. Settled bills keep their printed name. */
async function renameOnRunningBills(customer: Customer, previousName: string | undefined): Promise<string[]> {
  const name = customer.name?.trim();
  if (!name || name === previousName?.trim()) return [];
  const db = getDb();
  const bills = (await db.orders.where("status").equals("held").toArray())
    .filter((o) => normalisePhone(o.customer?.phone) === customer.id && o.customer?.name?.trim() !== name);
  for (const o of bills) await db.orders.put({ ...o, customer: { ...o.customer, name }, synced: false });
  return bills.flatMap((o) => (o.uid ? [o.uid] : []));
}

/** Record money received against what a guest owes. */
export async function recordDuePayment(customerId: string, amount: number, mode: PaymentMode, by?: string): Promise<void> {
  const db = getDb();
  const customer = await db.customers.get(customerId);
  if (!customer) throw new Error("This guest isn't on this device yet. Sync and try again.");
  const entry = { id: newUid(), amount: Math.round(amount * 100) / 100, mode, at: Date.now(), ...(by ? { by } : {}) };
  await updateCustomer({ ...customer, duesPaid: [...(customer.duesPaid ?? []), entry] });
}

export async function adjustPoints(customerId: string, delta: number): Promise<void> {
  const db = getDb();
  const customer = await db.customers.get(customerId);
  if (!customer) return;
  await updateCustomer({ ...customer, pointsAdjustment: (customer.pointsAdjustment ?? 0) + Math.round(delta) });
}

export async function saveFeedback(order: Order, rating: 1 | 2 | 3 | 4 | 5, comment: string): Promise<void> {
  const db = getDb();
  const latest = order.uid ? await db.orders.where("uid").equals(order.uid).first() : undefined;
  if (latest?.id === undefined) return;
  await db.orders.update(latest.id, { feedback: { rating, at: Date.now(), ...(comment.trim() ? { comment: comment.trim() } : {}) }, synced: false });
  if (latest.uid) await markDirty(["order", latest.uid]);
}
