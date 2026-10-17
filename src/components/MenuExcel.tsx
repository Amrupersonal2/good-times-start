import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getDb } from "@/lib/db";
import { menuWorkbook, parseMenuWorkbook, type MenuImport } from "@/lib/menu-excel";
import { applyMenuImport, loadTabBistroMenu } from "@/lib/menu-actions";
import { downloadXlsx, readXlsx } from "@/lib/xlsx";
import { dayKey } from "@/lib/report-logic";

/** Download the menu as Excel, upload an edited copy, or load the TAB Bistro menu. */
export function MenuExcel({ restaurant, menuCount }: { restaurant: string; menuCount: number }) {
  const file = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<MenuImport | null>(null);
  const [fileName, setFileName] = useState("");
  const [removeOthers, setRemoveOthers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tabOpen, setTabOpen] = useState(false);

  const download = async () => {
    const [menu, materials] = await Promise.all([getDb().menu.toArray(), getDb().materials.toArray()]);
    const { getSettings } = await import("@/lib/db");
    const order = (await getSettings()).categoryOrder ?? [];
    downloadXlsx(`${restaurant || "menu"}-menu-${dayKey(Date.now())}`, menuWorkbook(menu, materials, restaurant || "Menu", order), { title: `${restaurant} menu` });
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const sheets = await readXlsx(await f.arrayBuffer());
      const [menu, materials] = await Promise.all([getDb().menu.toArray(), getDb().materials.toArray()]);
      setFileName(f.name);
      setRemoveOthers(false);
      setPreview(parseMenuWorkbook(sheets, menu, materials));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open that file. Save it as .xlsx and try again.");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await applyMenuImport(preview.items, preview.materials, { removeOthers });
      toast.success(`${r.dishes} dishes and ${r.ingredients} ingredients saved${r.removed ? `, ${r.removed} removed` : ""}`);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const loadTab = async () => {
    setBusy(true);
    try {
      const r = await loadTabBistroMenu(removeOthers);
      toast.success(`TAB Bistro menu loaded: ${r.dishes} dishes, ${r.ingredients} ingredients${r.removed ? `, ${r.removed} old dishes removed` : ""}`);
      setTabOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void download()} disabled={!menuCount}><Download />Excel</Button>
        <Button variant="outline" onClick={() => file.current?.click()} disabled={busy}><Upload />Import</Button>
        <Button variant="outline" onClick={() => { setRemoveOthers(menuCount > 0); setTabOpen(true); }}><FileSpreadsheet />TAB Bistro menu</Button>
        <input ref={file} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogTitle>Import {fileName}</DialogTitle>
          {preview ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["New dishes", preview.stats.newDishes], ["Updated dishes", preview.stats.updatedDishes],
                  ["New ingredients", preview.stats.newIngredients], ["Recipe lines", preview.stats.recipes],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="text-xl font-bold">{value}</div></div>
                ))}
              </div>
              {preview.errors.length ? (
                <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <p className="font-semibold">{preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} won't import</p>
                  <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5">{preview.errors.map((e) => <li key={e}>{e}</li>)}</ul>
                </div>
              ) : null}
              {preview.warnings.length ? (
                <div className="rounded-lg border border-gold/50 bg-gold/10 p-3">
                  <p className="font-semibold">Check these</p>
                  <ul className="mt-1 max-h-32 list-disc space-y-0.5 overflow-y-auto pl-5">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </div>
              ) : null}
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={removeOthers} onChange={(e) => setRemoveOthers(e.target.checked)} />
                <span>Remove dishes that aren't in this file<span className="block text-xs text-muted-foreground">Past bills keep their dishes either way.</span></span>
              </label>
              <Button className="w-full" disabled={busy || !preview.items.length} onClick={() => void apply()}>
                {busy ? "Saving…" : `Save ${preview.items.length} dish${preview.items.length === 1 ? "" : "es"}`}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={tabOpen} onOpenChange={setTabOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>Load the TAB Bistro menu</DialogTitle>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              131 dishes in 23 sections with printed prices, portions and add-ons, plus 95 ingredients and a recipe for every dish so each bill uses up stock.
              Recipe amounts are kitchen estimates per portion; adjust them to how your kitchen plates each dish.
            </p>
            {menuCount ? (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={removeOthers} onChange={(e) => setRemoveOthers(e.target.checked)} />
                <span>Replace the {menuCount} dishes on the menu now<span className="block text-xs text-muted-foreground">Past bills keep their dishes either way.</span></span>
              </label>
            ) : null}
            <Button className="w-full" disabled={busy} onClick={() => void loadTab()}>{busy ? "Loading…" : "Load TAB Bistro menu"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
