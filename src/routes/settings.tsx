import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";
import { AppShell, useRestaurantSettings } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, isAdmin, useStaff, type StaffRole } from "@/lib/auth-context";
import { getDb, getDeviceCode, loadSampleData, resetDevice, saveSettings, setDeviceCode } from "@/lib/db";
import { billNumber, computeTotals } from "@/lib/billing";
import { ALL_PAYMENT_MODES, GST_MODES, RESTAURANT_SAC } from "@/lib/billing-config";
import { savePrintConfig, usePrintConfig } from "@/lib/print-config";
import type { PrintConfig } from "@/lib/print-logic";
import { printKots } from "@/components/PrintHost";
import { Switch } from "@/components/ui/switch";
import { normaliseDeviceCode } from "@/lib/sync-core";
import { emailError, fssaiError, gstinError, upiError } from "@/lib/validation";
import type { PaymentMode, RestaurantSettings } from "@/lib/types";
import { OrderingSettings } from "@/components/OrderingSettings";
import { LoginsSettings } from "@/components/LoginsSettings";
import { RolesSettings } from "@/components/RolesSettings";
import { TerminalsSettings } from "@/components/TerminalsSettings";
import { cn } from "@/lib/utils";
import { Dropdown } from "@/components/Dropdown";
import { Segmented } from "@/components/Segmented";
import { can } from "@/lib/permissions";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — XTSY POS" },
      { name: "description", content: "Restaurant details for GST bills, this device's bill series, and staff access." }, { property: "og:title", content: "Settings — XTSY POS" }, { property: "og:description", content: "Restaurant details for GST bills, this device's bill series, and staff access." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },],
  }),
  component: SettingsPage,
});

const ROLE_HELP: Record<StaffRole, string> = {
  owner: "Everything, including staff and restaurant details",
  manager: "Billing, menu, reports and inviting staff",
  cashier: "Billing, tables and settling bills",
  captain: "Taking orders and sending KOTs",
  kitchen: "Kitchen",
};
const INVITE_ROLES: StaffRole[] = ["manager", "cashier", "captain", "kitchen", "owner"];

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-border py-8 first:pt-2 lg:grid-cols-[16rem_1fr]">
      <div>
        <h2 className="text-base font-bold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      {children}
      {error ? <span className="mt-1 block text-xs font-normal text-destructive">{error}</span>
        : hint ? <span className="mt-1 block text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

const inputClass = "mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm disabled:bg-secondary disabled:text-muted-foreground";

function RestaurantDetails() {
  const { user, refresh } = useStaff();
  const saved = useRestaurantSettings();
  const canEdit = can(user, "settings.restaurant");
  const [form, setForm] = useState<RestaurantSettings>(saved);
  const [busy, setBusy] = useState(false);
  const savedJson = JSON.stringify(saved);
  useEffect(() => { setForm(JSON.parse(savedJson) as RestaurantSettings); }, [savedJson]);

  const set = (key: keyof RestaurantSettings) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const errors = {
    gstin: gstinError(form.gstin ?? ""),
    fssai: fssaiError(form.fssai ?? ""),
    upiVpa: upiError(form.upiVpa ?? ""),
  };
  const invalid = !form.name.trim() || Object.values(errors).some(Boolean);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (invalid) return;
    setBusy(true);
    const clean: RestaurantSettings = {
      ...saved,
      name: form.name.trim(),
      legalName: form.legalName?.trim() ?? "",
      address: form.address?.trim() ?? "",
      phone: form.phone?.trim() ?? "",
      gstin: form.gstin?.trim().toUpperCase() ?? "",
      fssai: form.fssai?.trim() ?? "",
      upiVpa: form.upiVpa?.trim() ?? "",
      billFooter: form.billFooter?.trim() ?? "",
    };
    await saveSettings(clean, !!user?.restaurantId);
    if (user?.restaurantId && clean.name !== user.restaurantName) {
      const { error } = await supabase.from("restaurants").update({ name: clean.name }).eq("id", user.restaurantId);
      if (!error) void refresh();
    }
    setBusy(false);
    toast.success("Restaurant details saved");
  };

  return (
    <Section title="Restaurant details" description="Printed on every bill. Your GSTIN and FSSAI number must match your registration.">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
        <Field label="Restaurant name"><input required maxLength={120} disabled={!canEdit} value={form.name} onChange={set("name")} className={inputClass} /></Field>
        <Field label="Legal business name" hint="If different, e.g. XTSY Ventures Private Limited"><input maxLength={160} disabled={!canEdit} value={form.legalName ?? ""} onChange={set("legalName")} className={inputClass} /></Field>
        <div className="sm:col-span-2"><Field label="Address"><textarea rows={2} maxLength={300} disabled={!canEdit} value={form.address ?? ""} onChange={set("address")} className={inputClass} /></Field></div>
        <Field label="Phone"><input type="tel" maxLength={20} disabled={!canEdit} value={form.phone ?? ""} onChange={set("phone")} className={inputClass} /></Field>
        <Field label="GSTIN" error={errors.gstin}><input maxLength={15} disabled={!canEdit} value={form.gstin ?? ""} onChange={set("gstin")} className={`${inputClass} uppercase`} /></Field>
        <Field label="FSSAI licence number" error={errors.fssai}><input inputMode="numeric" maxLength={14} disabled={!canEdit} value={form.fssai ?? ""} onChange={set("fssai")} className={inputClass} /></Field>
        <Field label="UPI ID for the payment QR" error={errors.upiVpa}><input maxLength={120} disabled={!canEdit} value={form.upiVpa ?? ""} onChange={set("upiVpa")} placeholder="restaurant@okaxis" className={inputClass} /></Field>
        <div className="sm:col-span-2"><Field label="Bill footer" hint="Shown at the bottom of every bill"><input maxLength={140} disabled={!canEdit} value={form.billFooter ?? ""} onChange={set("billFooter")} placeholder="Thank you! Visit again." className={inputClass} /></Field></div>
        {canEdit
          ? <div className="sm:col-span-2"><Button type="submit" disabled={busy || invalid}>{busy ? "Saving…" : "Save details"}</Button></div>
          : <p className="text-sm text-muted-foreground sm:col-span-2">Only the owner or a manager can change these.</p>}
      </form>
    </Section>
  );
}

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-0.5" />
      <span><span className="font-medium">{label}</span>{hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span> : null}</span>
    </label>
  );
}

const PAY_LABELS: Record<PaymentMode, string> = { cash: "Cash", upi: "UPI", card: "Card", wallet: "Wallet", credit: "Due (pay later)", points: "Loyalty points" };

function BillingSettings() {
  const { user } = useStaff();
  const saved = useRestaurantSettings();
  const canEdit = can(user, "settings.restaurant");
  const [form, setForm] = useState<RestaurantSettings>(saved);
  const [busy, setBusy] = useState(false);
  const savedJson = JSON.stringify(saved);
  useEffect(() => { setForm(JSON.parse(savedJson) as RestaurantSettings); }, [savedJson]);
  const patch = (p: Partial<RestaurantSettings>) => setForm((prev) => ({ ...prev, ...p }));
  const mode = form.gstMode ?? "regular";
  const modes = form.paymentModes ?? ALL_PAYMENT_MODES;
  const dirty = JSON.stringify(form) !== savedJson;

  const save = async () => {
    setBusy(true);
    await saveSettings({
      ...saved,
      gstMode: mode,
      pricesIncludeGst: Boolean(form.pricesIncludeGst),
      aggregatorGstByOperator: form.aggregatorGstByOperator ?? true,
      roundToRupee: form.roundToRupee ?? true,
      sac: (form.sac ?? "").trim() || RESTAURANT_SAC,
      serviceChargePct: Math.min(20, Math.max(0, Number(form.serviceChargePct) || 0)),
      staffDiscountLimit: Math.min(100, Math.max(0, Number(form.staffDiscountLimit ?? 10) || 0)),
      loyaltyPct: Math.min(25, Math.max(0, Number(form.loyaltyPct) || 0)),
      autoKotOnSettle: Boolean(form.autoKotOnSettle),
      paymentModes: modes.length ? modes : ["cash"],
      kotByStation: form.kotByStation ?? true,
      kotHeader: (form.kotHeader ?? "").trim(),
    }, !!user?.restaurantId);
    setBusy(false);
    toast.success("Billing settings saved on every device");
  };

  const sample = computeTotals([{ itemId: "x", name: "x", price: 1000, qty: 1, veg: true, gstRate: 5, station: "x" }], 0, 0,
    { inclusive: Boolean(form.pricesIncludeGst), exempt: mode !== "regular", roundToRupee: form.roundToRupee ?? true });

  return (
    <>
      <Section title="GST" description="How tax is worked out. Settled bills keep the rules they were made under.">
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="GST registration">
            {GST_MODES.map((m) => (
              <button key={m.v} type="button" role="radio" aria-checked={mode === m.v} disabled={!canEdit} onClick={() => patch({ gstMode: m.v })}
                className={`rounded-lg border p-3 text-left text-sm ${mode === m.v ? "border-primary bg-primary-tint" : "border-border"}`}>
                <span className="block font-semibold">{m.l}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{m.hint}</span>
              </button>
            ))}
          </div>
          {mode === "regular" ? <>
            <Toggle label="Menu prices include GST" hint={`A ₹1,000 dish then bills ₹${sample.total.toLocaleString("en-IN")} with ₹${(sample.cgst + sample.sgst).toLocaleString("en-IN")} GST inside it.`}
              checked={Boolean(form.pricesIncludeGst)} disabled={!canEdit} onChange={(v) => patch({ pricesIncludeGst: v })} />
            <Toggle label="Swiggy and Zomato pay GST on their orders" hint="Swiggy and Zomato pay GST on their orders (section 9(5)). Turn off only if your accountant says so."
              checked={form.aggregatorGstByOperator ?? true} disabled={!canEdit} onChange={(v) => patch({ aggregatorGstByOperator: v })} />
            <Field label="SAC code" hint="996331 is restaurant service; it appears in the GSTR-1 HSN summary.">
              <input disabled={!canEdit} maxLength={8} value={form.sac ?? RESTAURANT_SAC} onChange={(e) => patch({ sac: e.target.value.replace(/\D/g, "") })} className={`${inputClass} max-w-40`} />
            </Field>
          </> : (
            <p className="rounded-lg bg-secondary p-3 text-sm">Bills print as {mode === "composition" ? "a bill of supply with the required composition wording" : "plain bills"}, with no CGST or SGST.</p>
          )}
          <Toggle label="Round totals to the rupee" hint="Shows a round-off line on the bill." checked={form.roundToRupee ?? true} disabled={!canEdit} onChange={(v) => patch({ roundToRupee: v })} />
        </div>
      </Section>

      <Section title="Billing" description="Rules every counter follows when taking payment.">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Service charge %" hint="Offered on dine-in bills; off until the cashier ticks it. 0 hides it.">
              <input inputMode="decimal" disabled={!canEdit} value={form.serviceChargePct ?? 0} onChange={(e) => patch({ serviceChargePct: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })} className={inputClass} />
            </Field>
            <Field label="Cashier discount limit %" hint="Owners and managers can give any discount.">
              <input inputMode="numeric" disabled={!canEdit} value={form.staffDiscountLimit ?? 10} onChange={(e) => patch({ staffDiscountLimit: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })} className={inputClass} />
            </Field>
            <Field label="Loyalty points %" hint="Earned back on bills with a phone number; 1 point = ₹1. 0 turns it off.">
              <input inputMode="decimal" disabled={!canEdit} value={form.loyaltyPct ?? 0} onChange={(e) => patch({ loyaltyPct: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })} className={inputClass} />
            </Field>
          </div>
          <Toggle label="Send to kitchen automatically when settling" hint="For quick service: unsent items go to the kitchen when you settle."
            checked={Boolean(form.autoKotOnSettle)} disabled={!canEdit} onChange={(v) => patch({ autoKotOnSettle: v })} />
          <fieldset>
            <legend className="text-sm font-medium">Payment modes you accept</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {ALL_PAYMENT_MODES.map((m) => (
                <label key={m} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${modes.includes(m) ? "border-primary bg-primary-tint" : "border-border"}`}>
                  <input type="checkbox" disabled={!canEdit} checked={modes.includes(m)} onChange={(e) => patch({ paymentModes: e.target.checked ? [...modes, m] : modes.filter((x) => x !== m) })} />
                  {PAY_LABELS[m]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Section>

      <Section title="Kitchen tickets" description="How KOTs read on every device that prints them.">
        <div className="space-y-4">
          <Toggle label="One ticket per kitchen station" hint="Off prints one combined ticket. Cancellations always print separately."
            checked={form.kotByStation ?? true} disabled={!canEdit} onChange={(v) => patch({ kotByStation: v })} />
          <Field label="Line at the top of every KOT" hint="Optional, e.g. 'TAB Bistro kitchen'.">
            <input maxLength={40} disabled={!canEdit} value={form.kotHeader ?? ""} onChange={(e) => patch({ kotHeader: e.target.value })} className={`${inputClass} max-w-sm`} />
          </Field>
        </div>
      </Section>

      {canEdit ? (
        <div className="sticky bottom-20 z-10 flex items-center justify-end gap-3 py-4 lg:bottom-0">
          {dirty ? <span className="text-sm text-muted-foreground">Unsaved changes</span> : null}
          <Button disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save billing settings"}</Button>
        </div>
      ) : <p className="py-4 text-sm text-muted-foreground">Only the owner or a manager can change these.</p>}
    </>
  );
}

function PrintingSettings() {
  const saved = usePrintConfig();
  const [form, setForm] = useState<PrintConfig>(saved);
  const savedJson = JSON.stringify(saved);
  useEffect(() => { setForm(JSON.parse(savedJson) as PrintConfig); }, [savedJson]);
  const stations = useLiveQuery(async () => [...new Set((await getDb().menu.toArray()).map((m) => m.station))].sort(), [], []);
  const patch = (p: Partial<PrintConfig>) => setForm((prev) => ({ ...prev, ...p }));
  const dirty = JSON.stringify(form) !== savedJson;

  const testPrint = () => {
    const now = Date.now();
    void printKots([{ uid: `test-${now}`, orderId: 0, billNo: "TEST/0001", station: form.stations[0] ?? stations[0] ?? "Kitchen", kind: "order", tableLabel: "T1",
      lines: [{ name: "Test dish", qty: 2, note: "Printer check" }], status: "new", createdAt: now }], "reprint");
  };

  return (
    <Section title="This device's printer" description="Set up separately on each counter and kitchen printer.">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Paper width">
            <Dropdown<58 | 80> ariaLabel="Paper width" className="mt-1" value={form.paper} onChange={(paper) => patch({ paper })} options={[{ value: 80, label: "80 mm (3 inch)" }, { value: 58, label: "58 mm (2 inch)" }]} />
          </Field>
          <Field label="Bill copies">
            <input type="number" min={1} max={5} value={form.billCopies} onChange={(e) => patch({ billCopies: Number(e.target.value) })} className={inputClass} />
          </Field>
          <Field label="KOT copies">
            <input type="number" min={1} max={5} value={form.kotCopies} onChange={(e) => patch({ kotCopies: Number(e.target.value) })} className={inputClass} />
          </Field>
        </div>
        <Toggle label="Print KOTs sent from this device" checked={form.printKotOnSend} onChange={(v) => patch({ printKotOnSend: v })} />
        <Toggle label="Print KOTs sent from other devices" hint="For a station with its own printer. Keep this app open on that device."
          checked={form.printIncomingKots} onChange={(v) => patch({ printIncomingKots: v })} />
        <Toggle label="Print the bill as soon as it's settled" checked={form.autoPrintBill} onChange={(v) => patch({ autoPrintBill: v })} />
        <Toggle label="Large item text on KOTs" checked={form.largeKotText} onChange={(v) => patch({ largeKotText: v })} />
        {stations.length ? (
          <fieldset>
            <legend className="text-sm font-medium">Stations this device prints</legend>
            <p className="text-xs text-muted-foreground">None ticked prints every station.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {stations.map((st) => (
                <label key={st} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${form.stations.includes(st) ? "border-primary bg-primary-tint" : "border-border"}`}>
                  <input type="checkbox" checked={form.stations.includes(st)} onChange={(e) => patch({ stations: e.target.checked ? [...form.stations, st] : form.stations.filter((x) => x !== st) })} />
                  {st}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <p className="text-xs text-muted-foreground">For printing without a dialog, make the thermal printer the default and start Chrome with --kiosk-printing.</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!dirty} onClick={() => { void savePrintConfig(form).then(() => toast.success("Printer settings saved on this device")); }}>Save printer settings</Button>
          <Button variant="outline" onClick={testPrint}>Print a test KOT</Button>
        </div>
      </div>
    </Section>
  );
}

function ThisDevice() {
  const { user } = useStaff();
  const code = useLiveQuery(async () => {
    await getDb().meta.get("deviceCode");
    return getDeviceCode();
  }, [], "");
  const seq = useLiveQuery(async () => (await getDb().meta.get("billSeq"))?.value, [], 0);
  const menuCount = useLiveQuery(() => getDb().menu.count(), [], 0);
  const [draft, setDraft] = useState("");
  useEffect(() => { setDraft(code); }, [code]);
  const next = normaliseDeviceCode(draft);
  const canReset = can(user, "device.reset");

  const saveCode = async () => {
    if (!next || next === code) return;
    await setDeviceCode(next);
    toast.success(`New bill series ${next} starts at 0001`);
  };
  const reset = async () => {
    if (!window.confirm("Clear this device? Bills not yet synced will be lost. The restaurant's cloud copy is not affected.")) return;
    await resetDevice();
    toast.success("This device has been cleared");
    window.location.reload();
  };
  const loadSample = async () => {
    await loadSampleData();
    toast.success("Sample menu and tables added");
  };

  return (
    <Section title="This device" description="Each counter needs its own bill code so numbers never repeat.">
      <div className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Bill series code" hint={`Next bill: ${billNumber(next === code ? (typeof seq === "number" ? seq : 0) + 1 : 1, new Date(), next || code)}`}>
            <input value={draft} maxLength={4} disabled={!can(user, "settings.series")} onChange={(event) => setDraft(normaliseDeviceCode(event.target.value))} className={`${inputClass} w-32 uppercase`} />
          </Field>
          {can(user, "settings.series") ? <Button variant="secondary" disabled={!next || next === code} onClick={() => void saveCode()}>Start new series</Button>
            : <p className="pb-2 text-xs text-muted-foreground">Only the owner or a manager can change it.</p>}
        </div>
        {menuCount === 0 && can(user, "menu.edit") ? (
          <div className="rounded-lg border border-dashed border-border p-4">
            <p className="text-sm font-medium">Your menu is empty.</p>
            <p className="mt-1 text-sm text-muted-foreground">Start from a sample Indian menu and floor plan, then change prices and dishes in Menu.</p>
            <Button variant="outline" className="mt-3" onClick={() => void loadSample()}>Add sample menu and tables</Button>
          </div>
        ) : null}
        {canReset ? (
          <div>
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void reset()}><Trash2 />Clear this device</Button>
            <p className="mt-1 text-xs text-muted-foreground">Use this before moving the device to a different restaurant.</p>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

type Tab = "restaurant" | "billing" | "ordering" | "printing" | "logins" | "roles" | "terminals" | "device";

interface SettingCard { v: Tab | null; to?: string; hash?: string; l: string; d: string; group: string; staff?: boolean }

/** Settings grouped like a back office: outlet, staff and access, marketing, this device. */
const CARDS: SettingCard[] = [
  { v: "terminals", l: "Terminals", d: "See, rename, block or release each device and its bill series", group: "Outlet settings" },
  { v: null, to: "/tables", l: "Sections & Tables", d: "Manage the seating layout", group: "Outlet settings" },
  { v: "billing", l: "Invoice & GST", d: "GST, payment modes, discounts, service charge, loyalty and bill footer", group: "Outlet settings" },
  { v: "printing", l: "Printing & KOT", d: "Printers, KOT copies and kitchen stations", group: "Outlet settings", staff: true },
  { v: "ordering", l: "Guest ordering", d: "QR table ordering, online pickup and web address", group: "Outlet settings" },
  { v: "restaurant", l: "Restaurant details", d: "Name, address, GSTIN, FSSAI, UPI ID and contact", group: "Outlet settings" },
  { v: "logins", l: "Logins", d: "Admin, Reception and Waiter: passwords, WhatsApp, devices, install links", group: "Staff and access" },
  { v: "roles", l: "Roles", d: "What Reception and Waiter may do: Off, On or On with PIN", group: "Staff and access" },
  { v: null, to: "/marketing", l: "Brand & QR codes", d: "Logo, colours, offers and printable QR cards", group: "Marketing" },
  { v: null, to: "/marketing", hash: "whatsapp", l: "WhatsApp", d: "Campaigns, consent and automatic sending", group: "Marketing" },
  { v: "device", l: "This device", d: "Bill series (reset bill number), sync and clearing this device", group: "This device", staff: true },
];

function SettingsPage() {
  const { user } = useStaff();
  const admin = isAdmin(user);
  const cards = CARDS.filter((c) => admin || c.staff);
  const [tab, setTab] = useState<Tab | null>(() => {
    if (typeof window === "undefined") return null;
    const h = window.location.hash.slice(1) as Tab;
    return CARDS.some((c) => c.v === h) ? h : null;
  });
  const choose = (t: Tab | null) => {
    setTab(t);
    try { window.history.replaceState(null, "", t ? `#${t}` : window.location.pathname); } catch { /* ignore */ }
    window.scrollTo({ top: 0 });
  };
  if (!can(user, "settings.open")) {
    return <AppShell><p className="mx-auto max-w-md p-8 text-center text-sm text-muted-foreground">Settings aren't available for this login. Ask the admin.</p></AppShell>;
  }
  const visibleTab = tab && cards.some((c) => c.v === tab) ? tab : null;
  const groups = [...new Set(cards.map((c) => c.group))];
  const current = cards.find((c) => c.v === visibleTab);

  const link = (c: SettingCard, className: string, children: ReactNode) => c.v
    ? <button type="button" onClick={() => choose(c.v)} aria-current={visibleTab === c.v ? "page" : undefined} className={className}>{children}</button>
    : <Link to={c.to as "/tables"} {...(c.hash ? { search: { tab: c.hash } as never } : {})} className={className}>{children}</Link>;

  return (
    <AppShell>
      <div className="flex min-h-full">
        <aside className="sticky top-[57px] hidden h-[calc(100vh-57px)] w-64 shrink-0 overflow-y-auto border-r border-border bg-card py-5 lg:block" aria-label="Settings sections">
          <button type="button" onClick={() => choose(null)} className={cn("mx-3 mb-3 block w-[calc(100%-1.5rem)] rounded-lg px-3 py-2 text-left text-sm font-semibold", !visibleTab ? "bg-secondary" : "hover:bg-secondary/60")}>All settings</button>
          {groups.map((g) => (
            <div key={g} className="mb-4">
              <p className="px-6 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g}</p>
              {cards.filter((c) => c.group === g).map((c) => link(c,
                cn("relative block w-full px-6 py-2 text-left text-sm", visibleTab && visibleTab === c.v ? "bg-primary-tint font-semibold text-primary" : "text-foreground/80 hover:bg-secondary/60"),
                <>{visibleTab && visibleTab === c.v ? <span className="absolute inset-y-1 left-0 w-[3px] rounded-r bg-primary" aria-hidden="true" /> : null}{c.l}</>))}
            </div>
          ))}
        </aside>
        <div className="min-w-0 flex-1 p-4 lg:p-8">
          {visibleTab && current ? <>
            <button type="button" onClick={() => choose(null)} className="text-sm font-semibold text-primary lg:hidden">← All settings</button>
            <h1 className="mt-1 text-2xl font-bold lg:mt-0">{current.l}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{current.d}</p>
            <div className="mt-6 max-w-5xl">
              {visibleTab === "restaurant" ? <RestaurantDetails /> : null}
              {visibleTab === "billing" ? <BillingSettings /> : null}
              {visibleTab === "ordering" ? <OrderingSettings /> : null}
              {visibleTab === "printing" ? <PrintingSettings /> : null}
              {visibleTab === "logins" ? <LoginsSettings /> : null}
              {visibleTab === "roles" ? <RolesSettings /> : null}
              {visibleTab === "terminals" ? <TerminalsSettings /> : null}
              {visibleTab === "device" ? <ThisDevice /> : null}
            </div>
          </> : <>
            <h1 className="text-2xl font-bold">Settings</h1>
            {groups.map((g) => (
              <section key={g} className="mt-7">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{g}</h2>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {cards.filter((c) => c.group === g).map((c) => (
                    <article key={c.l} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                      <div className="flex-1 p-5"><h3 className="text-lg font-bold">{c.l}</h3><p className="mt-1 text-sm text-muted-foreground">{c.d}</p></div>
                      {link(c, "block w-full bg-sidebar py-3 text-center text-sm font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-accent", "Update")}
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </>}
        </div>
      </div>
    </AppShell>
  );
}
