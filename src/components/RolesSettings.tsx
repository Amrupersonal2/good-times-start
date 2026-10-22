import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/Segmented";
import { getSettings, saveSettings } from "@/lib/db";
import { useStaff } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { useRestaurantSettings } from "@/lib/use-settings";
import {
  ALWAYS_ADMIN, POLICY_ACTIONS, POLICY_SCREENS, hashPin, pinProblem, resolvePolicy,
  type Mode, type PolicyRole, type RolePolicy,
} from "@/lib/role-policy";
import { cn } from "@/lib/utils";

const ROLE_NAMES: Record<PolicyRole, string> = { cashier: "Reception (billdesk)", captain: "Waiter" };
const MODE_OPTIONS: { value: Mode; label: string }[] = [{ value: "off", label: "Off" }, { value: "on", label: "On" }, { value: "pin", label: "On with PIN" }];
const input = "mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-center text-lg tracking-[0.4em]";

export function RolesSettings() {
  const { user } = useStaff();
  const settings = useRestaurantSettings();
  const saved = useMemo(() => resolvePolicy(settings.rolePolicy), [settings.rolePolicy]);
  const [policy, setPolicy] = useState<RolePolicy>(saved);
  const [role, setRole] = useState<PolicyRole>("cashier");
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  useEffect(() => { setPolicy(saved); }, [saved]);

  if (!can(user, "roles.manage")) return <p className="py-8 text-sm text-muted-foreground">Only the admin can change roles.</p>;

  const dirty = JSON.stringify(policy) !== JSON.stringify(saved);
  const usesPin = (["cashier", "captain"] as PolicyRole[]).some((r) => Object.values(policy[r].actions).includes("pin"));
  const setAction = (id: keyof RolePolicy["cashier"]["actions"], mode: Mode) => setPolicy((p) => ({ ...p, [role]: { ...p[role], actions: { ...p[role].actions, [id]: mode } } }));
  const setScreen = (path: keyof RolePolicy["cashier"]["screens"], on: boolean) => setPolicy((p) => ({ ...p, cashier: { ...p.cashier, screens: { ...p.cashier.screens, [path]: on } } }));

  const save = async () => {
    setBusy(true);
    try {
      const current = await getSettings();
      await saveSettings({ ...current, rolePolicy: policy });
      toast.success("Roles saved. Every device follows them once it syncs.");
    } finally { setBusy(false); }
  };
  const pinError = pin ? pinProblem(pin) : null;
  const setAdminPin = async () => {
    if (pinError || pin !== pin2) return;
    setBusy(true);
    try {
      const current = await getSettings();
      await saveSettings({ ...current, adminPin: await hashPin(pin) });
      setPin(""); setPin2("");
      toast.success("Admin PIN set");
    } finally { setBusy(false); }
  };
  const clearPin = async () => {
    const current = await getSettings();
    const { adminPin: _drop, ...rest } = current;
    await saveSettings(rest);
    toast.success("Admin PIN removed. Actions set to On with PIN are blocked until a PIN is set.");
  };

  const actions = POLICY_ACTIONS.filter((a) => a.roles.includes(role));
  const groups = [...new Set(actions.map((a) => a.group))];
  return (
    <div className="space-y-8 py-2">
      <section className="grid gap-4 lg:grid-cols-[15rem_1fr]">
        <div>
          <h2 className="text-base font-bold">Roles</h2>
          <p className="mt-1 text-sm text-muted-foreground">What Reception and Waiter may do. <strong className="text-foreground">On with PIN</strong> asks for the admin PIN on the device each time. The admin can always do everything.</p>
        </div>
        <div className="space-y-5">
          <Segmented ariaLabel="Role" value={role} onChange={setRole} options={(Object.keys(ROLE_NAMES) as PolicyRole[]).map((r) => ({ value: r, label: ROLE_NAMES[r] }))} />

          {role === "cashier" ? (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <p className="border-b border-border bg-secondary/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Screens (Tables and bills are always on)</p>
              <ul className="divide-y divide-border">
                {POLICY_SCREENS.map((sc) => (
                  <li key={sc.path} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span><span className="block text-sm font-medium">{sc.label}</span><span className="block text-xs text-muted-foreground">{sc.hint}</span></span>
                    <label className="flex shrink-0 items-center gap-2 text-xs font-semibold text-muted-foreground">Allow<Switch checked={policy.cashier.screens[sc.path]} onCheckedChange={(v) => setScreen(sc.path, v)} aria-label={`Allow ${sc.label}`} /></label>
                  </li>
                ))}
              </ul>
            </div>
          ) : <p className="rounded-xl bg-secondary p-3 text-sm text-muted-foreground">Waiters use POS Waiter only: tables, menu and KOTs.</p>}

          {groups.map((group) => (
            <div key={group} className="overflow-hidden rounded-2xl border border-border bg-card">
              <p className="border-b border-border bg-secondary/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
              <ul className="divide-y divide-border">
                {actions.filter((a) => a.group === group).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0"><span className="block text-sm font-medium">{a.label}</span><span className="block text-xs text-muted-foreground">{a.hint}</span></span>
                    <Segmented ariaLabel={a.label} size="sm" value={policy[role].actions[a.id]} onChange={(m) => setAction(a.id, m)} options={MODE_OPTIONS} />
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="rounded-2xl border border-dashed border-border p-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-primary" />Always owner or manager only</p>
            <ul className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">{ALWAYS_ADMIN.map((t) => <li key={t}>· {t}</li>)}</ul>
            <p className="mt-2 text-xs text-muted-foreground">These are protected by the database too, so no device setting can open them.</p>
          </div>

          {usesPin && !settings.adminPin ? <p role="alert" className="rounded-xl bg-gold/15 p-3 text-sm font-medium text-gold-foreground">Some actions are On with PIN, but no admin PIN is set yet. Set one below, or those actions stay blocked.</p> : null}
          <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-border bg-card/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
            <Button disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save roles"}</Button>
            {dirty ? <Button variant="ghost" onClick={() => setPolicy(saved)}>Undo changes</Button> : <span className="text-sm text-muted-foreground">All changes saved</span>}
          </div>
        </div>
      </section>

      <section className="grid gap-4 border-t border-border pt-8 lg:grid-cols-[15rem_1fr]">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold"><ShieldCheck className="size-4" />Admin PIN</h2>
          <p className="mt-1 text-sm text-muted-foreground">Typed on a staff device to allow an action set to On with PIN. Only a scrambled copy is stored, never the PIN itself.</p>
        </div>
        <div className="max-w-sm space-y-3">
          <p className={cn("rounded-lg px-3 py-2 text-sm font-medium", settings.adminPin ? "bg-success/10 text-success" : "bg-secondary")}>{settings.adminPin ? "A PIN is set." : "No PIN set yet."}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">New PIN
              <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className={input} />
            </label>
            <label className="block text-sm font-medium">Repeat
              <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} className={input} />
            </label>
          </div>
          {pinError ? <p className="text-xs text-destructive">{pinError}</p> : pin && pin2 && pin !== pin2 ? <p className="text-xs text-destructive">The two PINs don't match.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !pin || !!pinError || pin !== pin2} onClick={() => void setAdminPin()}>{settings.adminPin ? "Change PIN" : "Set PIN"}</Button>
            {settings.adminPin ? <Button variant="ghost" className="text-destructive" onClick={() => void clearPin()}>Remove PIN</Button> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
