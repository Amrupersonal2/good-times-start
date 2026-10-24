import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, ChevronLeft, ChevronRight, FileSpreadsheet, LayoutGrid, Printer, Receipt, Sparkles, Store, UserPlus, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { AppShell, useRestaurantSettings } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, isAdmin, useStaff, type StaffRole } from "@/lib/auth-context";
import { getDb, loadSampleData, saveSettings, setDeviceCode } from "@/lib/db";
import { GST_MODES } from "@/lib/billing-config";
import { saveTable } from "@/lib/table-actions";
import { savePrintConfig, usePrintConfig } from "@/lib/print-config";
import { loadTabBistroMenu } from "@/lib/menu-actions";
import { normaliseDeviceCode } from "@/lib/sync-core";
import { emailError, fssaiError, gstinError, upiError } from "@/lib/validation";
import { APPS, DEVICE_LABELS, LOGINS, type LoginId } from "@/lib/staff-login-logic";
import type { RestaurantSettings } from "@/lib/types";
import { Dropdown } from "@/components/Dropdown";
import { useDeviceCode } from "@/lib/use-device-code";
import { useFirstSyncDone } from "@/lib/use-first-sync";

export const Route = createFileRoute("/setup")({
  head: () => ({ meta: [{ title: "Set up — XTSY POS" }, { name: "description", content: "Set up your restaurant on XTSY POS in a few minutes." }, { property: "og:title", content: "Set up — XTSY POS" }, { property: "og:description", content: "Set up your restaurant on XTSY POS in a few minutes." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },] }),
  component: SetupPage,
});

const STEPS = [
  { id: "details", label: "Restaurant", icon: Store },
  { id: "gst", label: "GST & bills", icon: Receipt },
  { id: "menu", label: "Menu", icon: UtensilsCrossed },
  { id: "tables", label: "Tables", icon: LayoutGrid },
  { id: "device", label: "Printing", icon: Printer },
  { id: "team", label: "Logins", icon: UserPlus },
] as const;

const inputClass = "mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm";

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium">{label}{children}
      {error ? <span className="mt-1 block text-xs font-normal text-destructive">{error}</span> : hint ? <span className="mt-1 block text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function SetupPage() {
  const { user } = useStaff();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const next = () => (step === STEPS.length - 1 ? setDone(true) : setStep((s) => s + 1));
  if (user && !isAdmin(user)) {
    return <AppShell><p className="mx-auto max-w-md p-8 text-center text-sm text-muted-foreground">Setup is for the owner or a manager.</p></AppShell>;
  }
  return (
    <AppShell>
      <div className="mx-auto max-w-4xl p-4 lg:p-8">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary"><Sparkles className="size-4" />Set up XTSY POS</div>
        <h1 className="mt-1 text-2xl font-bold">{done ? "You're ready to bill" : STEPS[step]?.label}</h1>
        <ol className="no-scrollbar mt-5 flex gap-2 overflow-x-auto" aria-label="Setup steps">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const state = done || i < step ? "done" : i === step ? "now" : "later";
            return (
              <li key={s.id}>
                <button type="button" onClick={() => { setDone(false); setStep(i); }} aria-current={state === "now" ? "step" : undefined}
                  className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${state === "now" ? "bg-primary text-primary-foreground" : state === "done" ? "bg-primary-tint text-primary" : "bg-secondary text-muted-foreground"}`}>
                  {state === "done" ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}{s.label}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-6 rounded-2xl border border-border bg-card p-5 lg:p-7">
          {done ? <Finished onBill={() => void navigate({ to: "/tables" })} />
            : step === 0 ? <DetailsStep onNext={next} />
            : step === 1 ? <GstStep onNext={next} />
            : step === 2 ? <MenuStep onNext={next} />
            : step === 3 ? <TablesStep onNext={next} />
            : step === 4 ? <DeviceStep onNext={next} />
            : <TeamStep onNext={next} />}
        </div>
        {!done && step > 0 ? <Button variant="ghost" className="mt-3" onClick={() => setStep((s) => s - 1)}><ChevronLeft />Back</Button> : null}
      </div>
    </AppShell>
  );
}

function NextBar({ busy, disabled, label = "Save and continue", onClick, skip }: { busy?: boolean; disabled?: boolean; label?: string; onClick: () => void; skip?: (() => void) | undefined }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <Button disabled={busy || disabled} onClick={onClick}>{busy ? "Saving…" : label}<ChevronRight /></Button>
      {skip ? <button type="button" className="text-sm font-semibold text-muted-foreground hover:text-foreground" onClick={skip}>Skip for now</button> : null}
    </div>
  );
}

function useForm() {
  const saved = useRestaurantSettings();
  const { user } = useStaff();
  const fallbackName = user?.restaurantName ?? "";
  const [form, setForm] = useState<RestaurantSettings>({ ...saved, name: saved.name || fallbackName });
  const json = JSON.stringify(saved);
  useEffect(() => {
    const parsed = JSON.parse(json) as RestaurantSettings;
    setForm({ ...parsed, name: parsed.name || fallbackName });
  }, [json, fallbackName]);
  return { form, setForm, saved, shared: !!user?.restaurantId };
}

function DetailsStep({ onNext }: { onNext: () => void }) {
  const { form, setForm, saved, shared } = useForm();
  const [busy, setBusy] = useState(false);
  const set = (key: keyof RestaurantSettings) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const errors = { gstin: gstinError(form.gstin ?? ""), fssai: fssaiError(form.fssai ?? ""), upiVpa: upiError(form.upiVpa ?? "") };
  const save = async () => {
    setBusy(true);
    await saveSettings({ ...saved, ...form, name: form.name.trim(), gstin: (form.gstin ?? "").trim().toUpperCase(), address: (form.address ?? "").trim(), phone: (form.phone ?? "").trim(), fssai: (form.fssai ?? "").trim(), upiVpa: (form.upiVpa ?? "").trim() }, shared);
    setBusy(false);
    onNext();
  };
  return (
    <div>
      <p className="text-sm text-muted-foreground">These print on every bill. GSTIN and FSSAI must match your registration.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Restaurant name"><input required maxLength={120} value={form.name} onChange={set("name")} className={inputClass} /></Field>
        <Field label="Legal business name" hint="If different from the restaurant name"><input maxLength={160} value={form.legalName ?? ""} onChange={set("legalName")} className={inputClass} /></Field>
        <div className="sm:col-span-2"><Field label="Address"><textarea rows={2} maxLength={300} value={form.address ?? ""} onChange={set("address")} className={inputClass} /></Field></div>
        <Field label="Phone"><input type="tel" maxLength={20} value={form.phone ?? ""} onChange={set("phone")} className={inputClass} /></Field>
        <Field label="GSTIN" error={errors.gstin} hint="Leave empty if not registered"><input maxLength={15} value={form.gstin ?? ""} onChange={set("gstin")} className={`${inputClass} uppercase`} /></Field>
        <Field label="FSSAI licence number" error={errors.fssai}><input inputMode="numeric" maxLength={14} value={form.fssai ?? ""} onChange={set("fssai")} className={inputClass} /></Field>
        <Field label="UPI ID" error={errors.upiVpa} hint="For the payment QR on bills and guest ordering"><input maxLength={120} value={form.upiVpa ?? ""} onChange={set("upiVpa")} placeholder="restaurant@okaxis" className={inputClass} /></Field>
      </div>
      <NextBar busy={busy} disabled={!form.name.trim() || Object.values(errors).some(Boolean)} onClick={() => void save()} />
    </div>
  );
}

function GstStep({ onNext }: { onNext: () => void }) {
  const { form, setForm, saved, shared } = useForm();
  const [busy, setBusy] = useState(false);
  const mode = form.gstMode ?? (form.gstin ? "regular" : "unregistered");
  const save = async () => {
    setBusy(true);
    await saveSettings({ ...saved, gstMode: mode, pricesIncludeGst: !!form.pricesIncludeGst, serviceChargePct: Math.min(20, Math.max(0, Number(form.serviceChargePct) || 0)),
      staffDiscountLimit: Math.min(100, Math.max(0, Number(form.staffDiscountLimit ?? 10))), loyaltyPct: Math.min(25, Math.max(0, Number(form.loyaltyPct) || 0)) }, shared);
    setBusy(false);
    onNext();
  };
  return (
    <div>
      <fieldset>
        <legend className="text-sm font-semibold">GST registration</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {GST_MODES.map((m) => (
            <button key={m.v} type="button" role="radio" aria-checked={mode === m.v} onClick={() => setForm((f) => ({ ...f, gstMode: m.v }))}
              className={`rounded-xl border p-3 text-left ${mode === m.v ? "border-primary bg-primary-tint" : "border-border"}`}>
              <span className="block text-sm font-semibold">{m.l}</span><span className="mt-0.5 block text-xs text-muted-foreground">{m.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>
      {mode === "regular" ? (
        <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={!!form.pricesIncludeGst} onChange={(e) => setForm((f) => ({ ...f, pricesIncludeGst: e.target.checked }))} />
          <span>Menu prices already include GST<span className="block text-xs text-muted-foreground">Leave unticked if GST is added on top of menu prices (most restaurants).</span></span></label>
      ) : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Service charge %" hint="Optional; offered per dine-in bill, off by default"><input inputMode="decimal" value={form.serviceChargePct ?? 0} onChange={(e) => setForm((f) => ({ ...f, serviceChargePct: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 }))} className={inputClass} /></Field>
        <Field label="Most discount staff can give (%)"><input inputMode="numeric" value={form.staffDiscountLimit ?? 10} onChange={(e) => setForm((f) => ({ ...f, staffDiscountLimit: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 }))} className={inputClass} /></Field>
        <Field label="Loyalty points back (%)" hint="0 turns loyalty off"><input inputMode="decimal" value={form.loyaltyPct ?? 0} onChange={(e) => setForm((f) => ({ ...f, loyaltyPct: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 }))} className={inputClass} /></Field>
      </div>
      <NextBar busy={busy} onClick={() => void save()} />
    </div>
  );
}

function MenuStep({ onNext }: { onNext: () => void }) {
  const count = useLiveQuery(() => getDb().menu.count(), [], 0);
  const synced = useFirstSyncDone();
  const admin = isAdmin(useStaff().user);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try { await work(); toast.success(message); }
    catch (error) { toast.error(error instanceof Error ? error.message : "That didn't work. Try again."); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <p className="text-sm text-muted-foreground">{count ? `Your menu has ${count} dishes. You can change prices, portions and recipes any time in Menu.` : !synced ? "Loading your restaurant's menu on this device…" : "Pick how to start your menu. Nothing here is final."}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Link to="/menu" className="rounded-xl border border-border p-4 hover:border-primary">
          <FileSpreadsheet className="size-5 text-primary" /><p className="mt-2 text-sm font-semibold">Import from Excel</p>
          <p className="mt-1 text-xs text-muted-foreground">Download the template in Menu → Excel, fill in dishes, portions and recipes, then Import.</p>
        </Link>
        <button type="button" disabled={busy || !synced || count > 0} onClick={() => void run(loadSampleData, "Sample menu and tables added")} className="rounded-xl border border-border p-4 text-left hover:border-primary disabled:opacity-50">
          <UtensilsCrossed className="size-5 text-primary" /><p className="mt-2 text-sm font-semibold">Start from a sample menu</p>
          <p className="mt-1 text-xs text-muted-foreground">A short Indian menu and floor plan to edit into your own.</p>
        </button>
        <Link to="/menu" className="rounded-xl border border-border p-4 hover:border-primary">
          <Check className="size-5 text-primary" /><p className="mt-2 text-sm font-semibold">Add dishes myself</p>
          <p className="mt-1 text-xs text-muted-foreground">Open Menu and add sections, dishes and kitchen stations.</p>
        </Link>
        {admin ? (
          <button type="button" disabled={busy} onClick={() => void run(() => loadTabBistroMenu(false), "TAB Bistro menu loaded")} className="rounded-xl border border-dashed border-border p-4 text-left hover:border-primary disabled:opacity-50 sm:col-span-3">
            <p className="text-sm font-semibold">Load the TAB Bistro by XTSY menu</p><p className="mt-1 text-xs text-muted-foreground">131 dishes with recipes. Shown to XTSY administrators only.</p>
          </button>
        ) : null}
      </div>
      <NextBar label="Continue" onClick={onNext} />
    </div>
  );
}

function TablesStep({ onNext }: { onNext: () => void }) {
  const existing = useLiveQuery(() => getDb().restTables.count(), [], 0);
  const [count, setCount] = useState(8);
  const [section, setSection] = useState("Main");
  const [seats, setSeats] = useState(4);
  const [prefix, setPrefix] = useState("T");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    const clean = prefix.trim().toUpperCase().slice(0, 3) || "T";
    for (let i = 1; i <= Math.min(80, Math.max(1, count)); i += 1) {
      const label = `${clean}${i}`;
      await saveTable({ id: `${section.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "main"}-${label.toLowerCase()}`, label, section: section.trim() || "Main", seats });
    }
    setBusy(false);
    toast.success(`${count} tables added in ${section}`);
    onNext();
  };
  return (
    <div>
      <p className="text-sm text-muted-foreground">{existing ? `You have ${existing} tables. Add another section here, or arrange them in Tables.` : "Add your dining tables. Each one gets its own QR code for guest ordering."}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <Field label="Section"><input maxLength={30} value={section} onChange={(e) => setSection(e.target.value)} placeholder="Main, Rooftop, Garden" className={inputClass} /></Field>
        <Field label="Name prefix" hint={`Tables will be ${prefix.toUpperCase() || "T"}1, ${prefix.toUpperCase() || "T"}2…`}><input maxLength={3} value={prefix} onChange={(e) => setPrefix(e.target.value)} className={`${inputClass} uppercase`} /></Field>
        <Field label="How many"><input type="number" min={1} max={80} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} className={inputClass} /></Field>
        <Field label="Seats each"><input type="number" min={1} max={20} value={seats} onChange={(e) => setSeats(Number(e.target.value) || 1)} className={inputClass} /></Field>
      </div>
      <NextBar busy={busy} label={`Add ${count} tables`} onClick={() => void add()} skip={onNext} />
    </div>
  );
}

function DeviceStep({ onNext }: { onNext: () => void }) {
  const config = usePrintConfig();
  const current = useDeviceCode();
  const [code, setCode] = useState("");
  const [paper, setPaper] = useState<58 | 80>(config.paper);
  const [autoBill, setAutoBill] = useState(config.autoPrintBill);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (current && !code) setCode(current); }, [current, code]);
  useEffect(() => { setPaper(config.paper); setAutoBill(config.autoPrintBill); }, [config.paper, config.autoPrintBill]);
  const save = async () => {
    setBusy(true);
    const next = normaliseDeviceCode(code);
    if (next && next !== current) await setDeviceCode(next);
    await savePrintConfig({ ...config, paper, autoPrintBill: autoBill });
    setBusy(false);
    onNext();
  };
  return (
    <div>
      <p className="text-sm text-muted-foreground">Settings for this device. Do the same on each billing counter, with a different series code on each.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Bill series code" hint="Short and unique per counter, e.g. C1, C2"><input maxLength={4} value={code} onChange={(e) => setCode(normaliseDeviceCode(e.target.value))} className={`${inputClass} uppercase`} /></Field>
        <Field label="Receipt paper">
          <Dropdown<58 | 80> ariaLabel="Receipt paper" className="mt-1" value={paper} onChange={setPaper} options={[{ value: 80, label: "80 mm (3 inch)" }, { value: 58, label: "58 mm (2 inch)" }]} />
        </Field>
        <label className="mt-6 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={autoBill} onChange={(e) => setAutoBill(e.target.checked)} />Print the bill as soon as it's settled</label>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">KOT copies, kitchen stations and printing incoming orders are in Settings → Printing.</p>
      <NextBar busy={busy} disabled={!normaliseDeviceCode(code)} onClick={() => void save()} />
    </div>
  );
}

const DEFAULT_DEVICES: Record<LoginId, (keyof typeof DEVICE_LABELS)[]> = { admin: ["android", "ios", "desktop"], billdesk: ["desktop"], waiter: ["android"] };

/** The three internal logins, one per app. Passwords and WhatsApp numbers are managed in Settings → Logins. */
function TeamStep({ onNext }: { onNext: () => void }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">TAB Bistro uses three logins, one for each app. No emails are sent; xtsy.pos is internal only.</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {(Object.keys(LOGINS) as LoginId[]).map((id) => {
          const app = APPS[LOGINS[id].app];
          return (
            <li key={id} className="rounded-xl border border-border p-4">
              <p className="text-sm font-semibold">{LOGINS[id].label}</p>
              <p className="mt-0.5 break-all text-xs font-mono">{LOGINS[id].email}</p>
              <p className="mt-2 text-xs text-muted-foreground">{app.name}{id === "admin" ? ", plus every other app" : ""}</p>
              <p className="text-xs text-muted-foreground">{DEFAULT_DEVICES[id].map((d) => DEVICE_LABELS[d]).join(" · ")}</p>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">Change passwords, WhatsApp numbers for password resets, devices, and switch logins on or off in <Link to="/settings" hash="logins" className="font-semibold text-primary">Settings → Logins</Link>.</p>
      <NextBar label="Finish" onClick={onNext} />
    </div>
  );
}

function Finished({ onBill }: { onBill: () => void }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">Your counter is ready. A few more things you can switch on when you like:</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        <li><Link to="/settings" hash="ordering" className="block rounded-xl border border-border p-4 hover:border-primary"><p className="text-sm font-semibold">Guest ordering</p><p className="mt-1 text-xs text-muted-foreground">QR codes on tables and an online pickup link.</p></Link></li>
        <li><Link to="/waiter" className="block rounded-xl border border-border p-4 hover:border-primary"><p className="text-sm font-semibold">Waiter tablets</p><p className="mt-1 text-xs text-muted-foreground">Install POS Waiter on Android phones and tablets from Settings → Logins.</p></Link></li>
        <li><Link to="/marketing" className="block rounded-xl border border-border p-4 hover:border-primary"><p className="text-sm font-semibold">Brand and WhatsApp</p><p className="mt-1 text-xs text-muted-foreground">Your look on the QR menu, printable QR cards, WhatsApp offers.</p></Link></li>
      </ul>
      <Button className="mt-6" onClick={onBill}>Go to tables<ChevronRight /></Button>
    </div>
  );
}
