import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";
import { AppShell, useRestaurantSettings } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, isAdmin, useStaff, type StaffRole } from "@/lib/auth-context";
import { getDb, getDeviceCode, loadSampleData, resetDevice, saveSettings, setDeviceCode } from "@/lib/db";
import { billNumber } from "@/lib/billing";
import { normaliseDeviceCode } from "@/lib/sync-core";
import { emailError, fssaiError, gstinError, upiError } from "@/lib/validation";
import type { RestaurantSettings } from "@/lib/types";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — XTSY POS" },
      { name: "description", content: "Restaurant details for GST bills, this device's bill series, and staff access." },
    ],
  }),
  component: SettingsPage,
});

const ROLE_HELP: Record<StaffRole, string> = {
  owner: "Everything, including staff and restaurant details",
  manager: "Billing, menu, reports and inviting staff",
  cashier: "Billing, tables and settling bills",
  captain: "Taking orders and sending KOTs",
  kitchen: "Kitchen display",
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
  const canEdit = !user || isAdmin(user);
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
      name: form.name.trim(),
      legalName: form.legalName?.trim() ?? "",
      address: form.address?.trim() ?? "",
      phone: form.phone?.trim() ?? "",
      gstin: form.gstin?.trim().toUpperCase() ?? "",
      fssai: form.fssai?.trim() ?? "",
      upiVpa: form.upiVpa?.trim() ?? "",
      billFooter: form.billFooter?.trim() ?? "",
      serviceChargePct: Math.min(20, Math.max(0, Number(form.serviceChargePct) || 0)),
      staffDiscountLimit: Math.min(100, Math.max(0, Number(form.staffDiscountLimit ?? 10) || 0)),
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
    <Section title="Restaurant details" description="Printed on every bill, plus the billing rules every device follows. Your GSTIN and FSSAI number must match your registration.">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
        <Field label="Restaurant name"><input required maxLength={120} disabled={!canEdit} value={form.name} onChange={set("name")} className={inputClass} /></Field>
        <Field label="Legal business name" hint="If different, e.g. XTSY Ventures Private Limited"><input maxLength={160} disabled={!canEdit} value={form.legalName ?? ""} onChange={set("legalName")} className={inputClass} /></Field>
        <div className="sm:col-span-2"><Field label="Address"><textarea rows={2} maxLength={300} disabled={!canEdit} value={form.address ?? ""} onChange={set("address")} className={inputClass} /></Field></div>
        <Field label="Phone"><input type="tel" maxLength={20} disabled={!canEdit} value={form.phone ?? ""} onChange={set("phone")} className={inputClass} /></Field>
        <Field label="GSTIN" error={errors.gstin}><input maxLength={15} disabled={!canEdit} value={form.gstin ?? ""} onChange={set("gstin")} className={`${inputClass} uppercase`} /></Field>
        <Field label="FSSAI licence number" error={errors.fssai}><input inputMode="numeric" maxLength={14} disabled={!canEdit} value={form.fssai ?? ""} onChange={set("fssai")} className={inputClass} /></Field>
        <Field label="UPI ID for the payment QR" error={errors.upiVpa}><input maxLength={120} disabled={!canEdit} value={form.upiVpa ?? ""} onChange={set("upiVpa")} placeholder="restaurant@okaxis" className={inputClass} /></Field>
        <div className="sm:col-span-2"><Field label="Bill footer" hint="Shown at the bottom of every bill"><input maxLength={140} disabled={!canEdit} value={form.billFooter ?? ""} onChange={set("billFooter")} placeholder="Thank you! Visit again." className={inputClass} /></Field></div>
        <Field label="Service charge %" hint="Offered on dine-in bills, off unless the cashier ticks it. Guests can decline it. Leave 0 to hide.">
          <input inputMode="decimal" disabled={!canEdit} value={form.serviceChargePct ?? 0}
            onChange={(e) => setForm((prev) => ({ ...prev, serviceChargePct: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 }))} className={inputClass} />
        </Field>
        <Field label="Highest discount for cashiers and captains (%)" hint="Owners and managers can give any discount.">
          <input inputMode="numeric" disabled={!canEdit} value={form.staffDiscountLimit ?? 10}
            onChange={(e) => setForm((prev) => ({ ...prev, staffDiscountLimit: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 }))} className={inputClass} />
        </Field>
        {canEdit
          ? <div className="sm:col-span-2"><Button type="submit" disabled={busy || invalid}>{busy ? "Saving…" : "Save details"}</Button></div>
          : <p className="text-sm text-muted-foreground sm:col-span-2">Only the owner or a manager can change these.</p>}
      </form>
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
  const canReset = !user || user.role === "owner";

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
    <Section title="This device" description="Each billing device needs its own series code so two counters never print the same bill number.">
      <div className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Bill series code" hint={`Next bill: ${billNumber(next === code ? (typeof seq === "number" ? seq : 0) + 1 : 1, new Date(), next || code)}`}>
            <input value={draft} maxLength={4} onChange={(event) => setDraft(normaliseDeviceCode(event.target.value))} className={`${inputClass} w-32 uppercase`} />
          </Field>
          <Button variant="secondary" disabled={!next || next === code} onClick={() => void saveCode()}>Start new series</Button>
        </div>
        {menuCount === 0 && (!user || isAdmin(user)) ? (
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

interface MemberRow { user_id: string; role: StaffRole; display_name: string; email: string }
interface InviteRow { id: string; email: string; role: StaffRole }

function Staff() {
  const { user, refresh } = useStaff();
  const restaurantId = user?.restaurantId ?? null;
  const owner = user?.role === "owner";
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("cashier");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!restaurantId) return;
    const [m, i] = await Promise.all([
      supabase.from("restaurant_members").select("user_id, role, display_name, email").eq("restaurant_id", restaurantId).order("created_at"),
      supabase.from("restaurant_invites").select("id, email, role").eq("restaurant_id", restaurantId).order("created_at"),
    ]);
    setMembers((m.data ?? []) as MemberRow[]);
    setInvites((i.data ?? []) as InviteRow[]);
  }, [restaurantId]);
  useEffect(() => { void load(); }, [load]);

  if (!restaurantId || !isAdmin(user)) return null;

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = emailError(email);
    if (problem) { setMessage(problem); return; }
    setBusy(true);
    setMessage("");
    const { error } = await supabase.from("restaurant_invites").insert({
      restaurant_id: restaurantId, email: email.trim().toLowerCase(), role, invited_by: user?.id ?? null,
    });
    setBusy(false);
    if (error) {
      setMessage(error.code === "23505" ? "That email already has an invite." : error.message);
      return;
    }
    setEmail("");
    toast.success("Invite saved. They join when they sign in with that email.");
    void load();
  };
  const cancelInvite = async (id: string) => {
    await supabase.from("restaurant_invites").delete().eq("id", id);
    void load();
  };
  const changeRole = async (member: MemberRow, next: StaffRole) => {
    const { error } = await supabase.rpc("set_member_role", { _restaurant_id: restaurantId, _user_id: member.user_id, _role: next });
    if (error) toast.error(error.message); else { toast.success("Role updated"); void load(); if (member.user_id === user?.id) void refresh(); }
  };
  const remove = async (member: MemberRow) => {
    if (!window.confirm(`Remove ${member.display_name || member.email} from this restaurant?`)) return;
    const { error } = await supabase.rpc("remove_member", { _restaurant_id: restaurantId, _user_id: member.user_id });
    if (error) toast.error(error.message); else void load();
  };

  return (
    <Section title="Staff" description="Invite people by the email they sign in with. Their role decides what they can change.">
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void invite(event)}>
        <div className="min-w-56 flex-1"><Field label="Email"><input type="email" maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="cashier@example.com" className={inputClass} /></Field></div>
        <Field label="Role">
          <select value={role} onChange={(event) => setRole(event.target.value as StaffRole)} className={inputClass}>
            {INVITE_ROLES.filter((r) => owner || r !== "owner").map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </Field>
        <Button type="submit" disabled={busy}><UserPlus />Invite</Button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">{ROLE_HELP[role]}.</p>
      {message ? <p role="alert" className="mt-2 text-sm text-destructive">{message}</p> : null}

      <ul className="mt-5 divide-y divide-border rounded-xl border border-border bg-card">
        {members.map((member) => (
          <li key={member.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{member.display_name || member.email}{member.user_id === user?.id ? " (you)" : ""}</div>
              <div className="truncate text-xs text-muted-foreground">{member.email}</div>
            </div>
            {owner ? (
              <select aria-label={`Role for ${member.email}`} value={member.role} onChange={(event) => void changeRole(member, event.target.value as StaffRole)} className="rounded-lg border border-input bg-card px-2 py-1.5 text-sm">
                {INVITE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            ) : <span className="text-sm text-muted-foreground">{ROLE_LABELS[member.role]}</span>}
            {owner && member.user_id !== user?.id ? (
              <Button size="icon" variant="ghost" aria-label={`Remove ${member.email}`} onClick={() => void remove(member)}><Trash2 /></Button>
            ) : null}
          </li>
        ))}
        {invites.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{inv.email}</div>
              <div className="text-xs text-muted-foreground"><span className="mr-1.5 rounded bg-gold/25 px-1.5 py-0.5 font-semibold text-gold-foreground">Invited</span>Joins as {ROLE_LABELS[inv.role]} on first sign-in</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void cancelInvite(inv.id)}>Cancel invite</Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function SwitchRestaurant() {
  const { user, switchRestaurant } = useStaff();
  if (!user || user.memberships.length < 2) return null;
  return (
    <Section title="Restaurant" description="You belong to more than one restaurant. Each device works with one at a time.">
      <select value={user.restaurantId ?? ""} onChange={(event) => switchRestaurant(event.target.value)} className={`${inputClass} max-w-sm`}>
        {user.memberships.map((m) => <option key={m.restaurantId} value={m.restaurantId}>{m.restaurantName} ({ROLE_LABELS[m.role]})</option>)}
      </select>
    </Section>
  );
}

function SettingsPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-4 lg:p-8">
        <h1 className="text-2xl font-bold">Settings</h1>
        <div className="mt-4">
          <RestaurantDetails />
          <ThisDevice />
          <Staff />
          <SwitchRestaurant />
        </div>
      </div>
    </AppShell>
  );
}
