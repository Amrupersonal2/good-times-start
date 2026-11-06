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

export async function updateCustomer(customer: Customer): Promise<void> {
  await getDb().customers.put(customer);
  await markDirty(["customer", customer.id]);
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
