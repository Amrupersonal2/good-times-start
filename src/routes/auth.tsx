import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Check, LayoutDashboard, Send, Store, Tablet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { setAppMode, syncAppModeFromUrl, useChosenApp } from "@/lib/app-mode";
import { useStaff } from "@/lib/auth-context";
import { APPS, LOGINS, appsFor, emailFromInput, loginForEmail, passwordProblem, type AppKind, type LoginId } from "@/lib/staff-login-logic";
import { confirmResetCode, ensureInternalLogins, requestResetCode } from "@/lib/staff-logins.functions";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.png";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — XTSY POS" },
      { name: "description", content: "Internal sign-in for TAB Bistro by XTSY: Business Manager, Restro POS and POS Waiter." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

const APP_ICONS: Record<AppKind, typeof Store> = { manager: LayoutDashboard, pos: Store, waiter: Tablet };
const input = "mt-1 w-full rounded-xl border border-input bg-card px-3.5 py-3 text-base";

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading, refresh } = useStaff();
  useEffect(() => { syncAppModeFromUrl(); }, []);
  const chosen = useChosenApp();
  const [submitting, setSubmitting] = useState(false);
  // Already signed in on this device: go straight to the app instead of asking again.
  useEffect(() => {
    if (loading || !user || submitting) return;
    const own = appsFor(user.login, user.role === "unknown" ? null : user.role);
    const target: AppKind = chosen && own.includes(chosen) ? chosen : own[0] ?? chosen ?? "manager";
    setAppMode(target);
    void navigate({ to: APPS[target].home, replace: true });
  }, [loading, user, submitting, chosen, navigate]);
  const app: AppKind | null = chosen;
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [resetting, setResetting] = useState(false);
  // Each app suggests its own login; anyone can type another.
  useEffect(() => { if (app && !login) setLogin(LOGINS[APPS[app].login].email); }, [app, login]);

  const pickApp = (a: AppKind) => { setAppMode(a); setLogin(LOGINS[APPS[a].login].email); setMessage(""); };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = emailFromInput(login);
    if (!email || !password) return;
    setBusy(true);
    setSubmitting(true);
    setMessage("");
    try {
      let result = await supabase.auth.signInWithPassword({ email, password });
      // First ever sign-in: the three internal logins are created (already confirmed) and linked, then we try once more.
      if (result.error && loginForEmail(email) && /invalid login credentials/i.test(result.error.message)) {
        try { await ensureInternalLogins(); } catch { /* the original error still explains it */ }
        result = await supabase.auth.signInWithPassword({ email, password });
      }
      if (result.error) {
        setMessage(/invalid login credentials/i.test(result.error.message) ? "That login or password isn't right." : /fetch|network/i.test(result.error.message) ? "No internet. The first sign-in on a device needs a connection." : result.error.message);
        return;
      }
      const internal = loginForEmail(email);
      const own = appsFor(internal, null);
      if (app && internal && !own.includes(app)) {
        await supabase.auth.signOut();
        setMessage(`${LOGINS[internal].label} uses ${APPS[own[0] as AppKind].name}, not ${APPS[app].name}.`);
        return;
      }
      const target = app ?? (internal ? LOGINS[internal].app : "manager");
      setAppMode(target);
      // Know who signed in before opening the app, so it opens on the first try.
      await refresh();
      await navigate({ to: APPS[target].home, replace: true });
    } finally {
      setBusy(false);
      setSubmitting(false);
    }
  };

  const AppIcon = app ? APP_ICONS[app] : Store;
  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[1fr_minmax(26rem,34rem)]">
      <aside className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3"><img src={logo} alt="" width={36} height={36} className="rounded-[10px]" /><span className="text-lg font-bold">TAB Bistro by XTSY</span></div>
        <div className="max-w-md">
          <p className="text-4xl font-bold leading-tight tracking-tight">{app ? APPS[app].name : "One restaurant. Three apps."}</p>
          <p className="mt-4 text-sidebar-foreground/75">{app ? APPS[app].for : "Business Manager for the admin, Restro POS for the counter, POS Waiter for the floor. Orders flow between them live."}</p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">Internal system. Logins are managed by the admin.</p>
      </aside>

      <div className="flex items-center justify-center p-4">
        <section className="w-full max-w-sm">
          <div className="flex items-center gap-3 lg:hidden"><img src={logo} alt="" width={36} height={36} className="rounded-[10px]" /><span className="font-bold">TAB Bistro by XTSY</span></div>

          {resetting ? <ResetPassword initial={loginForEmail(emailFromInput(login)) ?? (app ? APPS[app].login : "admin")} onDone={() => { setResetting(false); setPassword(""); setMessage("Password changed. Sign in with the new one."); }} onBack={() => setResetting(false)} /> : <>
            <div className="mt-6 flex items-center gap-3 lg:mt-0">
              <span className="grid size-11 place-items-center rounded-2xl bg-primary-tint text-primary"><AppIcon className="size-5" /></span>
              <div>
                <h1 className="text-2xl font-bold leading-tight">Sign in</h1>
                <p className="text-sm text-muted-foreground">{app ? APPS[app].name : "Choose your app"}</p>
              </div>
            </div>

            {!app ? (
              <div className="mt-5 grid gap-2" role="radiogroup" aria-label="App">
                {(Object.keys(APPS) as AppKind[]).map((a) => {
                  const Icon = APP_ICONS[a];
                  return (
                    <button key={a} type="button" role="radio" aria-checked={false} onClick={() => pickApp(a)}
                      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 text-left hover:border-primary">
                      <Icon className="size-5 shrink-0 text-primary" />
                      <span><span className="block font-semibold">{APPS[a].name}</span><span className="block text-xs text-muted-foreground">{APPS[a].for}</span></span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <form className="mt-6 space-y-3" onSubmit={(event) => void submit(event)}>
                <label className="block text-sm font-medium">Login
                  <input autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required maxLength={120} value={login} onChange={(e) => setLogin(e.target.value)} className={input} />
                </label>
                <label className="block text-sm font-medium">Password
                  <span className="relative block">
                    <input autoComplete="current-password" type={show ? "text" : "password"} required maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus className={cn(input, "pr-16")} />
                    <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 mt-0.5 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-semibold text-primary">{show ? "Hide" : "Show"}</button>
                  </span>
                </label>
                {message ? <p role="status" className={cn("text-sm", /changed/.test(message) ? "text-success" : "text-destructive")}>{message}</p> : null}
                <Button disabled={busy || !login.trim() || !password} className="h-12 w-full text-base" type="submit">{busy ? "Signing in…" : "Sign in"}</Button>
                <div className="flex items-center justify-between pt-1">
                  <button type="button" className="text-sm font-semibold text-primary" onClick={() => { setResetting(true); setMessage(""); }}>Forgot password?</button>
                  <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => { try { window.sessionStorage.removeItem("xtsy-app"); } catch { /* ignore */ } window.location.assign("/auth"); }}>Other app</button>
                </div>
              </form>
            )}
            <p className="mt-8 text-center text-xs text-muted-foreground">Once signed in, this device stays signed in and keeps working offline.</p>
          </>}
        </section>
      </div>
    </main>
  );
}

function ResetPassword({ initial, onDone, onBack }: { initial: LoginId; onDone: () => void; onBack: () => void }) {
  const [login, setLogin] = useState<LoginId>(initial);
  const [step, setStep] = useState<"ask" | "code">("ask");
  const [to, setTo] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const problem = password ? passwordProblem(password) : null;

  const send = async () => {
    setBusy(true);
    setMessage("");
    try {
      const r = await requestResetCode({ data: { login } });
      if (r.sent) { setTo(r.to ?? ""); setStep("code"); } else setMessage(r.reason ?? "Couldn't send a code.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't send a code. Check the internet.");
    } finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true);
    setMessage("");
    try {
      await confirmResetCode({ data: { login, code, password } });
      onDone();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't change the password.");
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-6 lg:mt-0">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-primary"><ArrowLeft className="size-4" />Sign in</button>
      <h1 className="mt-3 text-2xl font-bold">Reset password</h1>
      <p className="mt-1 text-sm text-muted-foreground">A 6-digit code goes to the WhatsApp number the admin set for the login.</p>
      {step === "ask" ? <>
        <div className="mt-5 grid gap-2" role="radiogroup" aria-label="Login">
          {(Object.keys(LOGINS) as LoginId[]).map((id) => (
            <button key={id} type="button" role="radio" aria-checked={login === id} onClick={() => setLogin(id)}
              className={cn("flex items-center justify-between rounded-xl border p-3 text-left", login === id ? "border-primary bg-primary-tint" : "border-border bg-card")}>
              <span><span className="block font-semibold">{LOGINS[id].label}</span><span className="block font-mono text-xs text-muted-foreground">{LOGINS[id].email}</span></span>
              {login === id ? <Check className="size-4 text-primary" /> : null}
            </button>
          ))}
        </div>
        {message ? <p role="status" className="mt-3 text-sm text-destructive">{message}</p> : null}
        <Button className="mt-4 h-12 w-full" disabled={busy} onClick={() => void send()}><Send />{busy ? "Sending…" : "Send code on WhatsApp"}</Button>
      </> : <>
        <p className="mt-4 rounded-xl bg-secondary p-3 text-sm">Code sent to <strong>{to}</strong>. It works for 10 minutes.</p>
        <label className="mt-3 block text-sm font-medium">6-digit code
          <input value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={cn(input, "tracking-[0.4em]")} />
        </label>
        <label className="mt-3 block text-sm font-medium">New password
          <input type="password" autoComplete="new-password" value={password} maxLength={72} onChange={(e) => setPassword(e.target.value)} className={input} />
        </label>
        {problem ? <p className="mt-1 text-xs text-destructive">{problem}</p> : null}
        {message ? <p role="status" className="mt-3 text-sm text-destructive">{message}</p> : null}
        <Button className="mt-4 h-12 w-full" disabled={busy || code.length !== 6 || !password || !!problem} onClick={() => void confirm()}>{busy ? "Saving…" : "Set new password"}</Button>
        <button type="button" className="mt-3 w-full text-sm font-semibold text-primary" disabled={busy} onClick={() => void send()}>Send a new code</button>
      </>}
    </div>
  );
}
