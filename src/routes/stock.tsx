import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { Download, Pencil, Plus, Trash2, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getDb } from "@/lib/db";
import { isAdmin, useStaff } from "@/lib/auth-context";
import { formatINR } from "@/lib/billing";
import { newUid } from "@/lib/sync-core";
import { STOCK_UNITS, countAdjustment, formatQty, isLow, purchaseTotal, stockLevels, stockValue } from "@/lib/stock-logic";
import { deleteSupplier, recordStockEntry, saveMaterial, saveSupplier } from "@/lib/stock-actions";
import { gstinError } from "@/lib/validation";
import { downloadXlsx } from "@/lib/xlsx";
import { dayKey } from "@/lib/report-logic";
import type { Material, StockEntry, StockUnit, Supplier } from "@/lib/types";

export const Route = createFileRoute("/stock")({
  head: () => ({
    meta: [
      { title: "Stock — XTSY POS" },
      { name: "description", content: "Raw material stock, purchases, wastage and suppliers, shared across your devices." },
    ],
  }),
  component: StockPage,
});

const inputClass = "mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm";
const ENTRY_LABEL: Record<StockEntry["type"], string> = { purchase: "Purchase", sale: "Used in bill", wastage: "Wastage", count: "Stock count", return: "Returned (void bill)" };
type Tab = "stock" | "purchases" | "suppliers" | "history";

function num(raw: string): number | null {
  const value = Number(raw.trim());
  return raw.trim() !== "" && Number.isFinite(value) ? value : null;
}

function MaterialForm({ material, onDone }: { material: Material | null; onDone: () => void }) {
  const [name, setName] = useState(material?.name ?? "");
  const [unit, setUnit] = useState<StockUnit>(material?.unit ?? "kg");
  const [low, setLow] = useState(String(material?.lowStockLevel ?? 1));
  const [cost, setCost] = useState(material?.costPerUnit !== undefined ? String(material.costPerUnit) : "");
  const [opening, setOpening] = useState("");
  const [error, setError] = useState("");
  const { user } = useStaff();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const lowLevel = num(low);
    const costValue = cost.trim() ? num(cost) : undefined;
    const openingQty = opening.trim() ? num(opening) : 0;
    if (!name.trim()) { setError("Enter the material name, like Paneer."); return; }
    if (lowLevel === null || lowLevel < 0 || costValue === null || (costValue ?? 0) < 0 || openingQty === null || openingQty < 0) {
      setError("Quantities and cost must be numbers, 0 or more.");
      return;
    }
    const id = material?.id ?? newUid();
    await saveMaterial({ id, name: name.trim().slice(0, 60), unit, lowStockLevel: lowLevel, ...(costValue !== undefined ? { costPerUnit: costValue } : {}) });
    if (!material && openingQty > 0) {
      await recordStockEntry({ type: "count", items: [{ materialId: id, qty: openingQty }], note: "Opening stock", ...(user ? { by: user.displayName } : {}) });
    }
    toast.success(material ? `${name.trim()} updated` : `${name.trim()} added`);
    onDone();
  };

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <label className="block text-sm font-medium">Name<input autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Paneer" className={inputClass} /></label>
      <div className="grid grid-cols-3 gap-3">
        <label className="block text-sm font-medium">Unit
          <select value={unit} onChange={(e) => setUnit(e.target.value as StockUnit)} className={inputClass}>
            {STOCK_UNITS.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">Warn at<input inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} className={inputClass} /></label>
        <label className="block text-sm font-medium">Cost / {unit}<input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="₹" className={inputClass} /></label>
      </div>
      {!material ? <label className="block text-sm font-medium">Stock on hand now ({unit})<input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" className={inputClass} /></label> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit">{material ? "Save material" : "Add material"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function MovementForm({ material, kind, onBooks, onDone }: { material: Material; kind: "count" | "wastage"; onBooks: number; onDone: () => void }) {
  const { user } = useStaff();
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const value = num(qty);
  const delta = value === null ? null : kind === "count" ? countAdjustment(onBooks, value) : -value;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (value === null || value < 0 || (kind === "wastage" && value === 0)) { setError(kind === "count" ? "Enter what you counted, 0 or more." : "Enter how much was wasted."); return; }
    if (delta === 0) { toast.success("Stock already matches"); onDone(); return; }
    await recordStockEntry({ type: kind, items: [{ materialId: material.id, qty: delta ?? 0 }], ...(note.trim() ? { note: note.trim() } : {}), ...(user ? { by: user.displayName } : {}) });
    toast.success(kind === "count" ? `${material.name} count saved` : `${material.name} wastage recorded`);
    onDone();
  };

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <p className="text-sm text-muted-foreground">On the books: {formatQty(onBooks, material.unit)}</p>
      <label className="block text-sm font-medium">{kind === "count" ? `Counted now (${material.unit})` : `Wasted (${material.unit})`}
        <input autoFocus inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className={inputClass} />
      </label>
      {kind === "count" && delta !== null && delta !== 0 ? <p className="text-sm">{delta > 0 ? "Adds" : "Removes"} {formatQty(Math.abs(delta), material.unit)}</p> : null}
      <label className="block text-sm font-medium">{kind === "wastage" ? "Why" : "Note (optional)"}
        <input maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "wastage" ? "Spoiled, dropped, expired…" : ""} className={inputClass} />
      </label>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit">{kind === "count" ? "Save count" : "Record wastage"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function PurchaseForm({ materials, suppliers, onDone }: { materials: Material[]; suppliers: Supplier[]; onDone: () => void }) {
  const { user } = useStaff();
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [rows, setRows] = useState([{ key: newUid(), materialId: materials[0]?.id ?? "", qty: "", cost: "" }]);
  const [error, setError] = useState("");
  const parsed = rows.map((r) => ({ materialId: r.materialId, qty: num(r.qty), unitCost: r.cost.trim() ? num(r.cost) : undefined }));
  const valid = parsed.filter((p) => p.materialId && p.qty !== null && p.qty > 0);
  const total = purchaseTotal(valid.map((p) => ({ materialId: p.materialId, qty: p.qty ?? 0, unitCost: p.unitCost ?? 0 })));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid.length || parsed.some((p) => p.unitCost === null)) { setError("Add at least one material with a quantity. Costs must be numbers."); return; }
    const items = valid.map((p) => ({ materialId: p.materialId, qty: p.qty ?? 0, ...(p.unitCost !== undefined && p.unitCost !== null ? { unitCost: p.unitCost } : {}) }));
    await recordStockEntry({ type: "purchase", items, ...(supplierId ? { supplierId } : {}), ...(reference.trim() ? { reference: reference.trim() } : {}), ...(user ? { by: user.displayName } : {}) });
    for (const item of items) {
      const material = materials.find((m) => m.id === item.materialId);
      if (material && item.unitCost !== undefined && item.unitCost !== material.costPerUnit) await saveMaterial({ ...material, costPerUnit: item.unitCost });
    }
    toast.success(`Purchase of ${formatINR(total, 0)} recorded`);
    onDone();
  };

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium">Supplier
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputClass}>
            <option value="">Not recorded</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">Invoice number<input maxLength={40} value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} /></label>
      </div>
      <div className="space-y-2">
        {rows.map((row, index) => {
          const unit = materials.find((m) => m.id === row.materialId)?.unit ?? "";
          const update = (change: Partial<typeof row>) => setRows(rows.map((r, i) => (i === index ? { ...r, ...change } : r)));
          return (
            <div key={row.key} className="flex gap-2">
              <select aria-label="Material" value={row.materialId} onChange={(e) => update({ materialId: e.target.value })} className="min-w-0 flex-1 rounded-lg border border-input bg-card px-2 py-2 text-sm">
                {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <input aria-label="Quantity" inputMode="decimal" value={row.qty} onChange={(e) => update({ qty: e.target.value })} placeholder={unit || "Qty"} className="w-20 rounded-lg border border-input bg-card px-2 py-2 text-right text-sm" />
              <input aria-label="Cost per unit" inputMode="decimal" value={row.cost} onChange={(e) => update({ cost: e.target.value })} placeholder={`₹/${unit}`} className="w-20 rounded-lg border border-input bg-card px-2 py-2 text-right text-sm" />
              {rows.length > 1 ? <Button type="button" size="icon" variant="ghost" aria-label="Remove line" onClick={() => setRows(rows.filter((_, i) => i !== index))}><X /></Button> : null}
            </div>
          );
        })}
      </div>
      <Button type="button" size="sm" variant="ghost" onClick={() => setRows([...rows, { key: newUid(), materialId: materials[0]?.id ?? "", qty: "", cost: "" }])}><Plus />Add line</Button>
      <p className="text-right text-sm font-semibold">Total {formatINR(total)}</p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={!valid.length}>Record purchase</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function SupplierForm({ supplier, onDone }: { supplier: Supplier | null; onDone: () => void }) {
  const [name, setName] = useState(supplier?.name ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [gstin, setGstin] = useState(supplier?.gstin ?? "");
  const [note, setNote] = useState(supplier?.note ?? "");
  const gstProblem = gstinError(gstin);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || gstProblem) return;
    await saveSupplier({ id: supplier?.id ?? newUid(), name: name.trim().slice(0, 80), ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(gstin.trim() ? { gstin: gstin.trim().toUpperCase() } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
    toast.success(supplier ? `${name.trim()} updated` : `${name.trim()} added`);
    onDone();
  };
  const remove = async () => {
    if (!supplier || !window.confirm(`Delete ${supplier.name}? Past purchases keep their records.`)) return;
    await deleteSupplier(supplier.id);
    onDone();
  };
  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <label className="block text-sm font-medium">Name<input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium">Phone<input type="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} /></label>
        <label className="block text-sm font-medium">GSTIN<input maxLength={15} value={gstin} onChange={(e) => setGstin(e.target.value)} className={`${inputClass} uppercase`} />
          {gstProblem ? <span className="mt-1 block text-xs font-normal text-destructive">{gstProblem}</span> : null}</label>
      </div>
      <label className="block text-sm font-medium">What they supply<input maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Dairy, vegetables…" className={inputClass} /></label>
      <div className="flex gap-2">
        <Button type="submit" disabled={!name.trim() || !!gstProblem}>{supplier ? "Save supplier" : "Add supplier"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        {supplier ? <Button type="button" variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={() => void remove()}><Trash2 />Delete</Button> : null}
      </div>
    </form>
  );
}

function CountAllForm({ materials, levels, onDone }: { materials: Material[]; levels: Map<string, number>; onDone: () => void }) {
  const { user } = useStaff();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const filled = materials.filter((m) => (counts[m.id] ?? "").trim() !== "");
  const shown = q.trim() ? materials.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase())) : materials;

  const save = async () => {
    const items: StockEntry["items"] = [];
    for (const m of filled) {
      const value = num(counts[m.id] ?? "");
      if (value === null || value < 0) { toast.error(`${m.name}: enter 0 or more.`); return; }
      const delta = countAdjustment(levels.get(m.id) ?? 0, value);
      if (delta !== 0) items.push({ materialId: m.id, qty: delta });
    }
    if (items.length) await recordStockEntry({ type: "count", items, note: `Stock count of ${filled.length} items`, ...(user ? { by: user.displayName } : {}) });
    toast.success(items.length ? `${items.length} item${items.length === 1 ? "" : "s"} adjusted` : "Stock already matches your count");
    onDone();
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Enter what's on the shelf now. Leave an item blank to skip it. Use this for opening stock too.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an ingredient" className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm" />
      <ul className="max-h-[52vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {shown.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{m.name}<span className="block text-xs text-muted-foreground">On the books {formatQty(levels.get(m.id) ?? 0, m.unit)}</span></span>
            <input aria-label={`Counted ${m.name}`} inputMode="decimal" value={counts[m.id] ?? ""} onChange={(e) => setCounts({ ...counts, [m.id]: e.target.value })}
              className="w-24 rounded-lg border border-input bg-card px-2 py-1.5 text-right" />
            <span className="w-10 text-xs text-muted-foreground">{m.unit}</span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button disabled={!filled.length} onClick={() => void save()}>Save count of {filled.length} item{filled.length === 1 ? "" : "s"}</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

type Sheet =
  | { kind: "material"; material: Material | null }
  | { kind: "count" | "wastage"; material: Material }
  | { kind: "purchase" }
  | { kind: "count-all" }
  | { kind: "supplier"; supplier: Supplier | null };

function StockPage() {
  const { user } = useStaff();
  const admin = !user || isAdmin(user);
  const materials = useLiveQuery(() => getDb().materials.toArray(), [], []);
  const suppliers = useLiveQuery(() => getDb().suppliers.toArray(), [], []);
  const entries = useLiveQuery(() => getDb().stockEntries.toArray(), [], []);
  const [tab, setTab] = useState<Tab>("stock");
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const active = materials.filter((m) => !m.archived).sort((a, b) => a.name.localeCompare(b.name));
  const levels = useMemo(() => stockLevels(entries), [entries]);
  const low = active.filter((m) => isLow(m, levels.get(m.id) ?? 0));
  const purchases = entries.filter((e) => e.type === "purchase").sort((a, b) => b.at - a.at).slice(0, 60);
  const history = [...entries].sort((a, b) => b.at - a.at).slice(0, 100);
  const nameOf = (id: string) => materials.find((m) => m.id === id)?.name ?? "Removed material";
  const unitOf = (id: string): StockUnit => materials.find((m) => m.id === id)?.unit ?? "pcs";
  const close = () => setSheet(null);
  const exportStock = () => {
    const supplierName = (id?: string) => suppliers.find((x) => x.id === id)?.name ?? "";
    const levelRows = active.map((m) => {
      const level = levels.get(m.id) ?? 0;
      return [m.name, m.unit, level, m.lowStockLevel, m.costPerUnit ?? null, Math.max(0, level) * (m.costPerUnit ?? 0), level < 0 ? "Below zero — count it" : isLow(m, level) ? "Low" : "OK"];
    });
    downloadXlsx(`stock-${dayKey(Date.now())}`, [
      { name: "Stock", title: "Stock on hand", subtitle: new Date().toLocaleString("en-IN"), totals: true,
        columns: [{ header: "Ingredient", width: 40 }, { header: "Unit" }, { header: "On hand", format: "qty" }, { header: "Warn at", format: "qty" }, { header: "Cost per unit", format: "inr" }, { header: "Stock value", format: "inr", total: true }, { header: "Status" }],
        rows: levelRows },
      { name: "Purchases", title: "Purchases", totals: true,
        columns: [{ header: "Date", format: "datetime" }, { header: "Supplier", width: 28 }, { header: "Invoice" }, { header: "Ingredient", width: 34 }, { header: "Qty", format: "qty" }, { header: "Unit" }, { header: "Cost per unit", format: "inr" }, { header: "Amount", format: "inr", total: true }],
        rows: entries.filter((e) => e.type === "purchase").sort((a, b) => b.at - a.at).flatMap((e) => e.items.map((i) => [e.at, supplierName(e.supplierId), e.reference ?? "", nameOf(i.materialId), i.qty, unitOf(i.materialId), i.unitCost ?? null, Math.round(i.qty * (i.unitCost ?? 0) * 100) / 100])) },
      { name: "Movements", title: "Every stock movement",
        columns: [{ header: "Date", format: "datetime" }, { header: "Type" }, { header: "Ingredient", width: 34 }, { header: "Change", format: "qty" }, { header: "Unit" }, { header: "Reference" }, { header: "Note", width: 30 }, { header: "By" }],
        rows: [...entries].sort((a, b) => b.at - a.at).flatMap((e) => e.items.map((i) => [e.at, ENTRY_LABEL[e.type], nameOf(i.materialId), i.qty, unitOf(i.materialId), e.reference ?? "", e.note ?? "", e.by ?? ""])) },
      { name: "Suppliers", title: "Suppliers",
        columns: [{ header: "Supplier", width: 30 }, { header: "Phone" }, { header: "GSTIN" }, { header: "Supplies", width: 40 }],
        rows: suppliers.map((x) => [x.name, x.phone ?? "", x.gstin ?? "", x.note ?? ""]) },
    ], { title: "Stock" });
  };

  const tabs: { v: Tab; l: string }[] = [
    { v: "stock", l: "Stock" },
    { v: "purchases", l: "Purchases" },
    { v: "suppliers", l: "Suppliers" },
    { v: "history", l: "History" },
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-4 lg:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Stock</h1>
            <p className="text-sm text-muted-foreground">
              {active.length} materials, worth {formatINR(stockValue(active, levels), 0)}{low.length ? `. ${low.length} running low.` : "."}
            </p>
          </div>
          {admin ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSheet({ kind: "material", material: null })}><Plus />Material</Button>
              <Button variant="outline" disabled={!active.length} onClick={() => exportStock()}><Download />Excel</Button>
              <Button variant="outline" disabled={!active.length} onClick={() => setSheet({ kind: "count-all" })}>Count all</Button>
              <Button disabled={!active.length} onClick={() => setSheet({ kind: "purchase" })}><Plus />Purchase</Button>
            </div>
          ) : null}
        </div>

        <div className="mb-5 flex gap-1 rounded-lg bg-secondary p-1 text-sm font-semibold" role="tablist">
          {tabs.map((t) => (
            <button key={t.v} role="tab" aria-selected={tab === t.v} onClick={() => setTab(t.v)} className={`flex-1 rounded-md py-2 ${tab === t.v ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{t.l}</button>
          ))}
        </div>

        {tab === "stock" ? (
          active.length ? (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {[...low, ...active.filter((m) => !low.includes(m))].map((m) => {
                const level = levels.get(m.id) ?? 0;
                const isLowNow = low.includes(m);
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{m.name}</div>
                      <div className="text-xs text-muted-foreground">Warn at {formatQty(m.lowStockLevel, m.unit)}{m.costPerUnit ? `, ${formatINR(m.costPerUnit)} per ${m.unit}` : ""}</div>
                    </div>
                    <span className={`rounded-md px-2 py-1 text-sm font-bold ${isLowNow ? "bg-gold/25 text-gold-foreground" : ""} ${level < 0 ? "text-destructive" : ""}`}>{formatQty(level, m.unit)}</span>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setSheet({ kind: "wastage", material: m })}>Wastage</Button>
                      {admin ? <Button size="sm" variant="ghost" onClick={() => setSheet({ kind: "count", material: m })}>Count</Button> : null}
                      {admin ? <Button size="icon" variant="ghost" aria-label={`Edit ${m.name}`} onClick={() => setSheet({ kind: "material", material: m })}><Pencil /></Button> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="font-semibold">No materials yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Add the ingredients you buy, like paneer, rice and oil. Then give each dish a recipe in Menu, and every bill uses them up automatically.</p>
            </div>
          )
        ) : null}

        {tab === "purchases" ? (
          purchases.length ? (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {purchases.map((p) => (
                <li key={p.id} className="px-4 py-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="font-semibold">{suppliers.find((s) => s.id === p.supplierId)?.name ?? "Supplier not recorded"}{p.reference ? <span className="ml-2 font-normal text-muted-foreground">Invoice {p.reference}</span> : null}</span>
                    <span className="font-semibold">{formatINR(purchaseTotal(p.items), 0)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{new Date(p.at).toLocaleDateString("en-IN")}: {p.items.map((i) => `${nameOf(i.materialId)} ${formatQty(i.qty, unitOf(i.materialId))}`).join(", ")}</div>
                </li>
              ))}
            </ul>
          ) : <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No purchases recorded yet.</p>
        ) : null}

        {tab === "suppliers" ? (
          <div>
            {admin ? <Button variant="outline" className="mb-3" onClick={() => setSheet({ kind: "supplier", supplier: null })}><Plus />Add supplier</Button> : null}
            {suppliers.length ? (
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {[...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{[s.phone, s.gstin && `GSTIN ${s.gstin}`, s.note].filter(Boolean).join(", ") || "No details"}</div>
                    </div>
                    {admin ? <Button size="icon" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setSheet({ kind: "supplier", supplier: s })}><Pencil /></Button> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No suppliers yet.</p>}
          </div>
        ) : null}

        {tab === "history" ? (
          history.length ? (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {history.map((e) => (
                <li key={e.id} className="px-4 py-2.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="font-semibold">{ENTRY_LABEL[e.type]}{e.reference ? <span className="ml-2 font-normal text-muted-foreground">{e.reference}</span> : null}</span>
                    <span className="text-xs text-muted-foreground">{new Date(e.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{e.by ? `, ${e.by}` : ""}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {e.items.map((i) => `${nameOf(i.materialId)} ${i.qty > 0 ? "+" : ""}${formatQty(i.qty, unitOf(i.materialId))}`).join(", ")}{e.note ? `. ${e.note}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nothing has moved yet.</p>
        ) : null}
      </div>

      <Dialog open={!!sheet} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
          {sheet?.kind === "material" ? <><DialogTitle>{sheet.material ? `Edit ${sheet.material.name}` : "Add material"}</DialogTitle><MaterialForm material={sheet.material} onDone={close} /></> : null}
          {sheet?.kind === "count" || sheet?.kind === "wastage" ? <><DialogTitle>{sheet.kind === "count" ? `Count ${sheet.material.name}` : `${sheet.material.name} wastage`}</DialogTitle>
            <MovementForm material={sheet.material} kind={sheet.kind} onBooks={levels.get(sheet.material.id) ?? 0} onDone={close} /></> : null}
          {sheet?.kind === "count-all" ? <><DialogTitle>Count stock</DialogTitle><CountAllForm materials={active} levels={levels} onDone={close} /></> : null}
          {sheet?.kind === "purchase" ? <><DialogTitle>Record purchase</DialogTitle><PurchaseForm materials={active} suppliers={suppliers} onDone={close} /></> : null}
          {sheet?.kind === "supplier" ? <><DialogTitle>{sheet.supplier ? `Edit ${sheet.supplier.name}` : "Add supplier"}</DialogTitle><SupplierForm supplier={sheet.supplier} onDone={close} /></> : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
