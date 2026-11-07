import { getDb } from "./db";
import { reservationDraft, type Reservation } from "./reservations";

/** Explicit staff command only: prepare a local draft, without allocating numbers, submitting KOTs or settling anything. */
export async function startReservationOrder(r: Reservation): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.orders, db.drafts, db.restTables, async () => {
    const table = await db.restTables.get(r.table_id);
    if (!table) throw new Error("This table hasn't synced yet. Wait for the floor to load and retry.");
    const running = await db.orders.where("tableId").equals(r.table_id).filter((o) => o.status === "held").first();
    const draft = await db.drafts.get(r.table_id);
    await db.drafts.put(reservationDraft(r, draft, running, Date.now()));
  });
}