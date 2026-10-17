import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { AppShell, useRestaurantSettings } from "@/components/AppShell";
import { MenuExcel } from "@/components/MenuExcel";
import { VegMark } from "@/components/VegMark";
import { Switch } from "@/components/ui/switch";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getDb, markDirty } from "@/lib/db";
import { isAdmin, useStaff } from "@/lib/auth-context";
import { CATEGORIES } from "@/lib/seed";
import { formatINR } from "@/lib/billing";
import { newUid } from "@/lib/sync-core";
import { DEFAULT_STATIONS, GST_RATES, PRICED_ORDER_TYPES, draftFromItem, itemFromDraft, orderCategories, type MenuDraft } from "@/lib/menu-logic";
import { foodCostShare, recipeCost } from "@/lib/stock-logic";
import type { GstRate, InventoryItem, Material, MenuItem } from "@/lib/types";
import { Dropdown } from "@/components/Dropdown";
import { ConfirmButton } from "@/components/ConfirmButton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/menu")({
  head: () => ({
    meta: [
      { title: "Menu — XTSY POS" },
      { name: "description", content: "Add dishes, portions, add-ons, prices, GST and stock. Changes reach every device." },
    ],
  }),
  component: MenuPage,
});

const inputClass = "mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm";

interface StockDraft { tracked: boolean; quantity: string; threshold: string }

function OptionRows({ label, hint, rows, onChange, pricePlaceholder }: {
  label: string;
  hint: string;
  rows: { id: string; name: string; price: string }[];
  onChange: (rows: { id: string; name: string; price: string }[]) => void;
  pricePlaceholder: string;
}) {
  const update = (index: number, key: "name" | "price", value: string) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  return (
    <fieldset className="rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-semibold">{label}</legend>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="mt-2 space-y-2">
        {rows.map((row, index) => (
          <div key={row.id} className="flex gap-2">
            <input aria-label={`${label} name`} value={row.name} maxLength={40} onChange={(e) => update(index, "name", e.target.value)} placeholder="Name" className="min-w-0 flex-1 rounded-lg border border-input bg-card px-3 py-2 text-sm" />
            <input aria-label={`${label} price`} value={row.price} inputMode="decimal" onChange={(e) => update(index, "price", e.target.value)} placeholder={pricePlaceholder} className="w-24 rounded-lg border border-input bg-card px-3 py-2 text-right text-sm" />
            <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${row.name || label}`} onClick={() => onChange(rows.filter((_, i) => i !== index))}><X /></Button>
          </div>
        ))}
      </div>
      <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => onChange([...rows, { id: newUid().slice(0, 8), name: "", price: "" }])}><Plus />Add</Button>
    </fieldset>
  );
}

function ItemEditor({ item, stock, categories, stations, materials, onClose }: {
  item: MenuItem | null;
  stock: InventoryItem | undefined;
  categories: string[];
  stations: string[];
  materials: Material[];
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<MenuDraft>(() => draftFromItem(item ?? undefined));
  const [stockDraft, setStockDraft] = useState<StockDraft>({
    tracked: stock?.tracked ?? false,
    quantity: String(stock?.quantity ?? 0),
    threshold: String(stock?.lowStockThreshold ?? 5),
  });
  const [errors, setErrors] = useState<string[]>([]);
  const set = <K extends keyof MenuDraft>(key: K, value: MenuDraft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = item?.id ?? newUid();
    const result = itemFromDraft(id, draft);
    if ("errors" in result) { setErrors(result.errors); return; }
    const quantity = Number(stockDraft.quantity);
    const threshold = Number(stockDraft.threshold);
    if (stockDraft.tracked && (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(threshold) || threshold < 0)) {
      setErrors(["Stock and low-stock level must be 0 or more."]);
      return;
    }
    const db = getDb();
    await db.menu.put({ ...result.item, stockTracked: stockDraft.tracked });
    const changes: ["menu" | "inventory", string][] = [["menu", id]];
    if (stockDraft.tracked || stock) {
      await db.inventory.put({
        id, menuItemId: id, name: result.item.name, unit: "portions",
        quantity: stockDraft.tracked ? quantity : stock?.quantity ?? 0,
        lowStockThreshold: stockDraft.tracked ? threshold : stock?.lowStockThreshold ?? 5,
        tracked: stockDraft.tracked, synced: false,
      });
      changes.push(["inventory", id]);
    }
    await markDirty(...changes);
    toast.success(item ? `${result.item.name} updated` : `${result.item.name} added`);
    onClose();
  };

  const remove = async () => {
    if (!item) return;
    await getDb().menu.delete(item.id);
    await markDirty(["menu", item.id]);
    toast.success(`${item.name} deleted`);
    onClose();
  };

  return (
    <form onSubmit={(event) => void save(event)} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium sm:col-span-2">Dish name
          <input required autoFocus maxLength={80} value={draft.name} onChange={(e) => set("name", e.target.value)} className={inputClass} />
        </label>
        <label className="block text-sm font-medium">Category
          <input list="menu-categories" maxLength={40} value={draft.category} onChange={(e) => set("category", e.target.value)} placeholder="Starters" className={inputClass} />
        </label>
        <label className="block text-sm font-medium">Kitchen station
          <input list="menu-stations" maxLength={40} value={draft.station} onChange={(e) => set("station", e.target.value)} className={inputClass} />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">KOTs print and show per station</span>
        </label>
        <label className="block text-sm font-medium">Price (₹, before GST)
          <input inputMode="decimal" disabled={draft.variants.length > 0} value={draft.variants.length ? "" : draft.price} onChange={(e) => set("price", e.target.value)} placeholder={draft.variants.length ? "Set by portions" : "0"} className={`${inputClass} disabled:bg-secondary`} />
        </label>
        <label className="block text-sm font-medium">GST
          <Dropdown<GstRate> ariaLabel="GST rate" className="mt-1" value={draft.gstRate} onChange={(rate) => set("gstRate", rate)} options={GST_RATES.map((r) => ({ value: r, label: `${r}%` }))} />
        </label>
      </div>
      <datalist id="menu-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="menu-stations">{stations.map((s) => <option key={s} value={s} />)}</datalist>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Veg or non-veg">
        {([true, false] as const).map((veg) => (
          <button key={String(veg)} type="button" role="radio" aria-checked={draft.veg === veg} onClick={() => set("veg", veg)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${draft.veg === veg ? "border-primary bg-primary-tint" : "border-border"}`}>
            <VegMark veg={veg} />{veg ? "Veg" : "Non-veg"}
          </button>
        ))}
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold">
          <input type="checkbox" checked={draft.popular} onChange={(e) => set("popular", e.target.checked)} />Show in Popular
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold">
          <Switch checked={draft.available} onCheckedChange={(v) => set("available", v)} />Available
        </label>
      </div>

      <OptionRows label="Portions" hint="Like Half and Full. The cashier picks one; each has its own price." rows={draft.variants} onChange={(rows) => set("variants", rows)} pricePlaceholder="₹" />
      <OptionRows label="Add-ons" hint="Extras the cashier can tick, like Extra cheese. Price can be 0." rows={draft.addons} onChange={(rows) => set("addons", rows)} pricePlaceholder="₹ extra" />

      {draft.variants.length === 0 ? (
        <fieldset className="rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold">Different prices by order type</legend>
          <p className="text-xs text-muted-foreground">Leave blank to use the main price.</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PRICED_ORDER_TYPES.map(({ v, l }) => (
              <label key={v} className="text-xs font-medium">{l}
                <input inputMode="decimal" value={draft.prices[v] ?? ""} onChange={(e) => set("prices", { ...draft.prices, [v]: e.target.value })} placeholder={draft.price || "—"} className="mt-1 w-full rounded-lg border border-input bg-card px-2 py-2 text-right text-sm" />
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-semibold">Recipe, per portion</legend>
        {materials.length ? <>
          <p className="text-xs text-muted-foreground">Ingredients used up each time this dish is billed. Leave empty if you don't track ingredients.</p>
          <div className="mt-2 space-y-2">
            {draft.recipe.map((row, index) => {
              const unit = materials.find((m) => m.id === row.materialId)?.unit ?? "";
              const update = (change: Partial<typeof row>) => set("recipe", draft.recipe.map((r, i) => (i === index ? { ...r, ...change } : r)));
              return (
                <div key={index} className="flex gap-2">
                  <Dropdown ariaLabel="Ingredient" className="min-w-0 flex-1" value={row.materialId} onChange={(materialId) => update({ materialId })} placeholder="Choose ingredient" searchable
                    options={materials.map((m) => ({ value: m.id, label: m.name, hint: m.unit }))} />
                  <input aria-label="Amount per portion" inputMode="decimal" value={row.qty} onChange={(e) => update({ qty: e.target.value })} placeholder={unit || "Amount"} className="w-24 rounded-lg border border-input bg-card px-2 py-2 text-right text-sm" />
                  <span className="w-10 self-center text-xs text-muted-foreground">{unit}</span>
                  <Button type="button" size="icon" variant="ghost" aria-label="Remove ingredient" onClick={() => set("recipe", draft.recipe.filter((_, i) => i !== index))}><X /></Button>
                </div>
              );
            })}
          </div>
          <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => set("recipe", [...draft.recipe, { materialId: "", qty: "" }])}><Plus />Add ingredient</Button>
        </> : <p className="text-xs text-muted-foreground">Add raw materials in Stock first to give this dish a recipe.</p>}
      </fieldset>

      <fieldset className="rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-semibold">Portions in stock</legend>
        <label className="flex items-center gap-2 text-sm"><Switch checked={stockDraft.tracked} onCheckedChange={(v) => setStockDraft((s) => ({ ...s, tracked: v }))} />Count portions and stop selling at zero</label>
        {stockDraft.tracked ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-xs font-medium">Portions in stock
              <input inputMode="numeric" value={stockDraft.quantity} onChange={(e) => setStockDraft((s) => ({ ...s, quantity: e.target.value }))} className="mt-1 w-full rounded-lg border border-input bg-card px-2 py-2 text-right text-sm" />
            </label>
            <label className="text-xs font-medium">Warn when at or below
              <input inputMode="numeric" value={stockDraft.threshold} onChange={(e) => setStockDraft((s) => ({ ...s, threshold: e.target.value }))} className="mt-1 w-full rounded-lg border border-input bg-card px-2 py-2 text-right text-sm" />
            </label>
          </div>
        ) : null}
      </fieldset>

      {errors.length ? <ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-destructive">{errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit">{item ? "Save dish" : "Add dish"}</Button>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        {item ? <ConfirmButton id={`delete-dish-${item.id}`} className={cn(buttonVariants({ variant: "ghost" }), "ml-auto text-destructive hover:text-destructive")} armedClassName="!bg-destructive !text-destructive-foreground"
          onConfirm={remove} confirm={<><Trash2 />Tap again to delete</>}><Trash2 />Delete</ConfirmButton> : null}
      </div>
    </form>
  );
}

function MenuPage() {
  const menu = useLiveQuery(() => getDb().menu.toArray(), [], []);
  const inventory = useLiveQuery(() => getDb().inventory.toArray(), [], []);
  const materials = useLiveQuery(async () => (await getDb().materials.toArray()).filter((m) => !m.archived).sort((a, b) => a.name.localeCompare(b.name)), [], []);
  const { user } = useStaff();
  const canEdit = !user || isAdmin(user);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<MenuItem | "new" | null>(null);

  const settings = useRestaurantSettings();
  const categories = useMemo(() => orderCategories(menu.map((m) => m.category), settings.categoryOrder, CATEGORIES), [menu, settings.categoryOrder]);
  const stations = useMemo(() => [...new Set([...DEFAULT_STATIONS, ...menu.map((m) => m.station)])], [menu]);
  const shown = q.trim() ? menu.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase())) : menu;
  const stockFor = (id: string) => inventory.find((i) => i.menuItemId === id);

  const toggle = async (id: string, available: boolean) => {
    await getDb().menu.update(id, { available });
    await markDirty(["menu", id]);
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-4 lg:p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Menu</h1>
            <p className="text-sm text-muted-foreground">{menu.length} dishes. Changes reach every device within seconds.</p>
          </div>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <MenuExcel restaurant={settings.name} menuCount={menu.length} />
              <Button onClick={() => setEditing("new")}><Plus />Add dish</Button>
            </div>
          ) : null}
        </div>
        <div className="relative mb-5 max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a dish" className="w-full rounded-lg border border-input bg-card py-2.5 pl-9 pr-3 text-sm" />
        </div>

        {menu.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="font-semibold">No dishes yet</p>
            <p className="mt-1 text-sm text-muted-foreground">{canEdit ? "Add your first dish, load the TAB Bistro menu, or import an Excel file." : "Ask the owner or a manager to add the menu."}</p>
          </div>
        ) : null}

        {categories.map((c) => {
          const rows = shown.filter((m) => m.category === c);
          if (!rows.length) return null;
          return (
            <section key={c} className="mb-6">
              <h2 className="mb-2 text-base font-bold">{c}</h2>
              <div className="divide-y divide-border rounded-xl border border-border bg-card">
                {rows.map((m) => {
                  const stock = stockFor(m.id);
                  const low = stock?.tracked && stock.quantity <= stock.lowStockThreshold;
                  return (
                    <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                      <VegMark veg={m.veg} />
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-sm font-semibold ${m.available ? "" : "text-muted-foreground line-through"}`}>{m.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.station}, GST {m.gstRate}%
                          {m.variants?.length ? `, ${m.variants.map((v) => v.name).join(" / ")}` : ""}
                          {m.addons?.length ? `, ${m.addons.length} add-on${m.addons.length === 1 ? "" : "s"}` : ""}
                          {(() => {
                            const v = m.variants?.[0];
                            const cost = recipeCost(m, materials, v?.id);
                            if (!cost) return null;
                            const share = foodCostShare(cost, v?.price ?? m.price);
                            return <span className={share > 0.35 ? "font-semibold text-gold-foreground" : ""}>, food cost {Math.round(share * 100)}%</span>;
                          })()}
                        </div>
                      </div>
                      {stock?.tracked ? (
                        <span className={`hidden rounded-md px-2 py-0.5 text-xs font-semibold sm:inline ${low ? "bg-gold/25 text-gold-foreground" : "bg-secondary text-muted-foreground"}`}>
                          {stock.quantity === 0 ? "Sold out" : `${stock.quantity} left`}
                        </span>
                      ) : null}
                      <span className="w-20 text-right text-sm font-semibold">{m.variants?.length ? `from ${formatINR(m.price, 0)}` : formatINR(m.price, 0)}</span>
                      <Switch aria-label={`${m.name} available`} checked={m.available} onCheckedChange={(v) => void toggle(m.id, v)} />
                      {canEdit ? <Button size="icon" variant="ghost" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m)}><Pencil /></Button> : null}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {q && shown.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No dishes match "{q}"</p> : null}
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
          <DialogTitle>{editing === "new" ? "Add dish" : editing ? `Edit ${editing.name}` : ""}</DialogTitle>
          {editing !== null ? (
            <ItemEditor
              key={editing === "new" ? "new" : editing.id}
              item={editing === "new" ? null : editing}
              stock={editing === "new" ? undefined : stockFor(editing.id)}
              categories={categories}
              stations={stations}
              materials={materials}
              onClose={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
