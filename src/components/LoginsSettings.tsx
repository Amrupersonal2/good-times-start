import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Copy, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConfirmButton } from "@/components/ConfirmButton";
import { useStaff } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { waNumber } from "@/lib/marketing-logic";
import { APPS, APP_LINKS, DEVICE_LABELS, LOGINS, passwordProblem, type AppKind, type DeviceKind, type LoginId, type LoginRow } from "@/lib/staff-login-logic";
import { ensureInternalLogins, resetLoginPassword } from "@/lib/staff-logins.functions";
import { cn } from "@/lib/utils";

const input = "mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm";
const ORDER: LoginId[] = ["admin", "billdesk", "waiter"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as unknown as { from: (t: string) => any };

async function loadLogins(): Promise<LoginRow[]> {
  // Creates any missing login and links all three; never changes a password.
  await ensureInternalLogins();
  const { data, error } = await db().from("staff_logins").select("login, active, devices, whatsapp, display_name");
  if (error) throw new Error("The database needs updating first (migration 0010).");
  return ((data ?? []) as LoginRow[]).sort((a, b) => ORDER.indexOf(a.login) - ORDER.indexOf(b.login));
}

function LoginCard({ row, onSaved }: { row: LoginRow; onSaved: () => void }) {
  const isAdminLogin = row.login === "admin";
  const [name, setName] = useState(row.display_name);
  const [phone, setPhone] = useState(row.whatsapp ? `+${row.whatsapp}` : "");
  const [devices, setDevices] = useState<DeviceKind[]>(row.devices);
  const [active, setActive] = useState(row.active);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(row.display_name); setPhone(row.whatsapp ? `+${row.whatsapp}` : ""); setDevices(row.devices); setActive(row.active); }, [row]);

  const wa = phone.trim() ? waNumber(phone) : "";
  const dirty = name.trim() !== row.display_name || (wa ?? "") !== row.whatsapp || devices.join() !== row.devices.join() || active !== row.active;
  const problem = !name.trim() ? "Add a name." : wa === null ? "Check the WhatsApp number." : !devices.length ? "Choose at least one kind of device." : null;
  const pwProblem = password ? passwordProblem(password) : null;

  const save = async () => {
    setBusy(true);
    const { data, error } = await db().from("staff_logins").update({ display_name: name.trim(), whatsapp: wa ?? "", devices, active }).eq("login", row.login).select("login");
    setBusy(false);
    if (error || !(data as unknown[] | null)?.length) { toast.error(error?.message ?? "Only the admin can change logins."); return; }
    toast.success(`${LOGINS[row.login].label} login saved${active !== row.active ? (active ? ": switched on" : ": switched off on every device") : ""}`);
    onSaved();
  };
  const setNewPassword = async () => {
    try {
      await resetLoginPassword({ data: { login: row.login, password } });
      setPassword("");
      toast.success(`New password set for ${LOGINS[row.login].email}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change the password");
    }
  };

  return (
    <article className={cn("rounded-2xl border bg-card p-5", active ? "border-border" : "border-dashed border-border opacity-80")}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold">{LOGINS[row.login].label}</h3>
          <p className="font-mono text-sm">{LOGINS[row.login].email}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{APPS[LOGINS[row.login].app].name}{isAdminLogin ? ", and every other app" : ""}</p>
        </div>
        {isAdminLogin ? <span className="inline-flex items-center gap-1 rounded-full bg-primary-tint px-2.5 py-1 text-xs font-semibold text-primary"><ShieldCheck className="size-3.5" />Always on, any device</span> : (
          <label className="flex items-center gap-2 text-sm font-medium">{active ? "On" : "Off"}<Switch checked={active} onCheckedChange={setActive} aria-label={`${LOGINS[row.login].label} login on or off`} /></label>
        )}
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">Name shown on bills and KOTs
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className={input} />
        </label>
        <label className="block text-sm font-medium">WhatsApp for password reset
          <input value={phone} maxLength={18} inputMode="tel" onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" className={input} />
        </label>
      </div>
      {!isAdminLogin ? (
        <fieldset className="mt-3">
          <legend className="text-sm font-medium">Can be used on</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {(Object.keys(DEVICE_LABELS) as DeviceKind[]).map((d) => {
              const on = devices.includes(d);
              return <button key={d} type="button" role="checkbox" aria-checked={on} onClick={() => setDevices((all) => (on ? all.filter((x) => x !== d) : [...all, d]))}
                className={cn("rounded-lg border px-3 py-1.5 text-sm font-medium", on ? "border-primary bg-primary-tint text-primary" : "border-border")}>{DEVICE_LABELS[d]}</button>;
            })}
          </div>
        </fieldset>
      ) : null}
      {problem && dirty ? <p className="mt-2 text-sm text-destructive">{problem}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={!dirty || busy || !!problem} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
        {dirty ? <Button variant="ghost" onClick={() => { setName(row.display_name); setPhone(row.whatsapp ? `+${row.whatsapp}` : ""); setDevices(row.devices); setActive(row.active); }}>Undo</Button> : null}
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <label className="block text-sm font-medium">New password
          <input type="password" autoComplete="new-password" value={password} maxLength={72} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters, letters and numbers" className={input} />
        </label>
        {pwProblem ? <p className="mt-1 text-xs text-destructive">{pwProblem}</p> : null}
        <ConfirmButton id={`pw-${row.login}`} disabled={!password || !!pwProblem} onConfirm={setNewPassword} className={cn(buttonVariants({ variant: "outline" }), "mt-2")}
          armedClassName="!bg-gold !text-gold-foreground" confirm="Tap again to change the password">Set password</ConfirmButton>
        <p className="mt-1 text-xs text-muted-foreground">Devices already signed in stay signed in.</p>
      </div>
    </article>
  );
}

function InstallCard({ app }: { app: AppKind }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = `${origin}${APP_LINKS[app]}`;
  const [qr, setQr] = useState("");
  useEffect(() => { void QRCode.toDataURL(url, { width: 240, margin: 1 }).then(setQr).catch(() => setQr("")); }, [url]);
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast.success("Link copied"); } catch { toast.error("Couldn't copy"); } };
  return (
    <div className="flex gap-4 rounded-2xl border border-border bg-card p-4">
      {qr ? <img src={qr} alt={`QR code to open ${APPS[app].name}`} width={112} height={112} className="size-28 shrink-0 rounded-lg border border-border bg-white p-1" /> : <div className="size-28 shrink-0 rounded-lg bg-secondary" />}
      <div className="min-w-0">
        <p className="font-semibold">{APPS[app].name}</p>
        <p className="text-xs text-muted-foreground">{APPS[app].for}</p>
        <p className="mt-2 text-xs text-muted-foreground">Scan on the device, sign in as <strong className="text-foreground">{LOGINS[APPS[app].login].label}</strong>, then use <em>Install app</em> (Chrome or Edge: install icon in the address bar; Android: menu → Install app).</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void copy()}><Copy />Copy link</Button>
          <Button size="sm" variant="outline" asChild><a href={APP_LINKS[app]} target="_blank" rel="noreferrer"><ExternalLink />Open</a></Button>
        </div>
      </div>
    </div>
  );
}

export function LoginsSettings() {
  const { user } = useStaff();
  const queryClient = useQueryClient();
  const allowed = can(user, "staff.manage");
  const q = useQuery({ queryKey: ["staff-logins"], queryFn: loadLogins, enabled: allowed, staleTime: 60_000, retry: false });
  if (!allowed) return <p className="py-8 text-sm text-muted-foreground">Only the admin can manage logins.</p>;
  return (
    <div className="space-y-8 py-2">
      <section className="grid gap-4 lg:grid-cols-[15rem_1fr]">
        <div>
          <h2 className="text-base font-bold">Logins</h2>
          <p className="mt-1 text-sm text-muted-foreground">Three internal logins, one per app. xtsy.pos is internal: no email is ever sent. A switched-off login stops working at once, even on devices already signed in.</p>
        </div>
        <div className="space-y-4">
          {q.isLoading ? <div className="h-40 animate-pulse rounded-2xl bg-card" /> : q.isError ? (
            <div className="rounded-2xl border border-border bg-card p-5 text-sm">
              <p className="font-semibold">Couldn't load the logins</p>
              <p className="mt-1 text-muted-foreground">{q.error instanceof Error ? q.error.message : "Check the internet and try again."}</p>
              <Button className="mt-3" variant="outline" onClick={() => void q.refetch()}><RefreshCw />Try again</Button>
            </div>
          ) : (q.data ?? []).map((row) => <LoginCard key={row.login} row={row} onSaved={() => void queryClient.invalidateQueries({ queryKey: ["staff-logins"] })} />)}
        </div>
      </section>
      <section className="grid gap-4 border-t border-border pt-8 lg:grid-cols-[15rem_1fr]">
        <div>
          <h2 className="text-base font-bold">Install the apps</h2>
          <p className="mt-1 text-sm text-muted-foreground">Each app installs from its own link and opens full screen, like a downloaded app. Install once per device.</p>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">{(["manager", "pos", "waiter"] as const).map((a) => <InstallCard key={a} app={a} />)}</div>
      </section>
    </div>
  );
}
