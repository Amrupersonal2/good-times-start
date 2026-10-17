import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — XTSY POS" },
      { name: "description", content: "Sign in to XTSY POS to share bills, tables and kitchen tickets across your restaurant's devices." },
      { property: "og:title", content: "Sign in — XTSY POS" },
      { property: "og:description", content: "Restaurant billing and KOTs that keep working offline." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = signup
      ? await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (response.error) { setMessage(response.error.message); return; }
    if (signup && !response.data.session) {
      setMessage("Check your email to confirm your account before signing in.");
      return;
    }
    await navigate({ to: "/", search: {} });
  };

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[1fr_minmax(24rem,32rem)]">
      <aside className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="text-lg font-bold text-sidebar-foreground">XTSY POS</div>
        <div className="max-w-md">
          <p className="text-4xl font-bold leading-tight tracking-tight text-sidebar-foreground">Every counter, waiter and kitchen screen on the same bill.</p>
          <p className="mt-4 text-sidebar-foreground/75">Billing keeps working when the internet drops and catches up the moment it's back.</p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">Private system. Staff access by invitation.</p>
      </aside>
      <div className="flex items-center justify-center p-4">
      <section className="w-full max-w-sm">
        <h1 className="text-2xl font-bold">{signup ? "Set up your login" : "Sign in"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{signup ? "For staff the owner has invited. Use the same email the invite went to." : "Staff login for TAB Bistro by XTSY."}</p>
        <form className="mt-6 space-y-3" onSubmit={(event) => void submit(event)}>
          <label className="block text-sm font-medium">Email
            <input autoComplete="email" type="email" required maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5" />
          </label>
          <label className="block text-sm font-medium">Password
            <input autoComplete={signup ? "new-password" : "current-password"} type="password" required minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5" />
          </label>
          {message ? <p role="status" className="text-sm text-destructive">{message}</p> : null}
          <Button disabled={busy} className="h-11 w-full" type="submit">{busy ? "Please wait…" : signup ? "Set up login" : "Sign in"}</Button>
        </form>
        <Button variant="link" className="mt-3 w-full" onClick={() => { setSignup(!signup); setMessage(""); }}>
          {signup ? "Already have a login? Sign in" : "Invited by the owner? Set up your login"}
        </Button>
        <p className="mt-6 text-center text-xs text-muted-foreground">Once signed in, this device stays signed in and keeps billing offline.</p>
      </section>
      </div>
    </main>
  );
}