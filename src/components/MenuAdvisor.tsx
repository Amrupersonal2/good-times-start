import { forwardRef, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, RefreshCw, LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { getDb } from "@/lib/db";
import { advisorSnapshot, menuAdvisorInput, type MenuAdvisorResult } from "@/lib/menu-advisor";
import { analyzeSalesMenu } from "@/lib/menu-advisor.functions";

export interface MenuAdvisorProps extends ComponentPropsWithoutRef<"section"> {
  restaurantId: string;
  from: number;
  to: number;
}

/** Owner-reviewed sales and menu analysis. Suggestions never modify POS records. */
export const MenuAdvisor = forwardRef<HTMLElement, MenuAdvisorProps>(function MenuAdvisor({ restaurantId, from, to, className, ...props }, ref) {
  const analyze = useServerFn(analyzeSalesMenu);
  const [sales, setSales] = useState("");
  const [menu, setMenu] = useState("");
  const [context, setContext] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MenuAdvisorResult | null>(null);
  const lock = useRef(false);
  const field = "w-full rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  async function loadPos() {
    setError("");
    try {
      const db = getDb();
      const scope = await db.meta.get("restaurantId");
      if (scope?.value !== restaurantId) { setError("This device’s sales have not been linked to your restaurant yet. You can paste your data below."); return; }
      const [orders, items] = await Promise.all([db.orders.where("createdAt").between(from, to, true, true).toArray(), db.menu.toArray()]);
      const snapshot = advisorSnapshot(orders, items, from, to);
      if (!orders.some((o) => o.status === "settled")) { setError("No settled sales in this period. Choose another period or paste your sales data."); return; }
      if (snapshot.sales.length > 30000 || snapshot.menu.length > 30000) { setError("This period has too much data. Select a shorter period or paste a smaller summary."); return; }
      setSales(snapshot.sales); setMenu(snapshot.menu); setResult(null);
    } catch { setError("Could not read this device’s sales. Your saved orders are unchanged."); }
  }

  async function submit() {
    if (lock.current) return;
    const parsed = menuAdvisorInput.safeParse({ restaurantId, sales, menu, context });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the supplied data."); return; }
    if (!navigator.onLine) { setError("Connect to the internet for AI analysis. Offline ordering is still available."); return; }
    lock.current = true; setBusy(true); setError(""); setResult(null);
    try {
      const response = await analyze({ data: parsed.data });
      if (response.ok) setResult(response.result); else setError(response.error);
    } catch { setError("Analysis could not be confirmed. Your input is preserved; check your connection and sign-in before trying again."); }
    finally { lock.current = false; setBusy(false); }
  }

  return <section ref={ref} className={cn("border-t border-border pt-5", className)} {...props}>
    <header className="mb-4 flex items-center gap-2"><Sparkles className="size-5 text-primary" aria-hidden="true" /><h2 className="text-lg font-bold">Menu advisor</h2></header>
    <Button variant="outline" className="mb-4" disabled={busy} onClick={() => void loadPos()}><RefreshCw className="size-4" />Use selected-period sales & menu</Button>
    <div className="space-y-4">
      <label className="block space-y-2"><span className="text-sm font-semibold">Sales data</span><textarea className={field} rows={6} value={sales} maxLength={30000} disabled={busy} onChange={(e) => { setSales(e.target.value); setResult(null); }} placeholder="Dates, dish names, quantities sold and revenue (₹)" /></label>
      <label className="block space-y-2"><span className="text-sm font-semibold">Menu data</span><textarea className={field} rows={5} value={menu} maxLength={30000} disabled={busy} onChange={(e) => { setMenu(e.target.value); setResult(null); }} placeholder="Dish, category, selling price (₹), portion and cost if known" /></label>
      <label className="block space-y-2"><span className="text-sm font-semibold">Business context <span className="font-normal text-muted-foreground">(optional)</span></span><textarea className={field} rows={2} value={context} maxLength={1500} disabled={busy} onChange={(e) => { setContext(e.target.value); setResult(null); }} placeholder="Goals, seasonal changes, promotions or ingredient costs" /></label>
      <p className="text-xs text-muted-foreground">The data above will be sent to AI for analysis. Leave out customer details and credentials. Suggestions do not change your menu.</p>
      <Button disabled={busy || !sales.trim() || !menu.trim()} onClick={() => void submit()}>{busy ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Sparkles className="size-4" />}{busy ? "Analyzing…" : "Analyze sales & menu"}</Button>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div aria-live="polite" aria-busy={busy}>
        {result ? <div className="space-y-5 border-t border-border pt-5">
          <p className="text-sm leading-relaxed">{result.summary}</p>
          <div><h3 className="mb-3 font-semibold">Sales trends</h3><ul className="space-y-3">{result.trends.map((t, i) => <li key={i} className="border-l-2 border-primary pl-3"><h4 className="text-sm font-semibold">{t.title}</h4><p className="mt-1 text-sm text-muted-foreground">{t.evidence}</p></li>)}</ul></div>
          <div><h3 className="mb-3 font-semibold">Menu improvements</h3><ol className="space-y-4">{result.recommendations.map((r, i) => <li key={i}><h4 className="text-sm font-semibold">{i + 1}. {r.title}</h4><p className="mt-1 text-sm text-muted-foreground">{r.reason}</p><p className="mt-1 text-sm">{r.action}</p></li>)}</ol></div>
          {result.limitations.length ? <div><h3 className="mb-2 text-sm font-semibold">Data limitations</h3><ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">{result.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></div> : null}
        </div> : null}
      </div>
    </div>
  </section>;
});