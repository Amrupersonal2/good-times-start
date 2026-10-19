import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { currentPinRequest, subscribePin } from "@/lib/pin-gate";
import { currentPinHash, currentPolicy, setRolePolicy, subscribePolicy } from "@/lib/permissions";
import { checkPin } from "@/lib/role-policy";
import { useRestaurantSettings } from "@/lib/use-settings";

const MAX_TRIES = 5;

/** Keeps the role policy and admin PIN in step with the restaurant settings. Renders nothing. */
const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;
export function PolicySync() {
  const settings = useRestaurantSettings();
  useIso(() => { setRolePolicy(settings.rolePolicy, settings.adminPin); }, [settings.rolePolicy, settings.adminPin]);
  return null;
}

/** Re-render when the admin changes what roles may do. */
export function usePolicy() {
  return useSyncExternalStore(subscribePolicy, currentPolicy, currentPolicy);
}

/** "Admin PIN needed" prompt, shown when an action is set to On with PIN. */
export function PinGate() {
  const request = useSyncExternalStore(subscribePin, currentPinRequest, () => null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => { setPin(""); setError(""); setTries(0); }, [request]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!request || busy) return;
    setBusy(true);
    const ok = await checkPin(pin, currentPinHash());
    setBusy(false);
    if (ok) { request.resolve(true); return; }
    const used = tries + 1;
    setTries(used);
    setPin("");
    if (used >= MAX_TRIES) { setError(""); request.resolve(false); return; }
    setError(`That PIN isn't right. ${MAX_TRIES - used} tr${MAX_TRIES - used === 1 ? "y" : "ies"} left.`);
  };

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) request?.resolve(false); }}>
      <DialogContent className="max-w-xs">
        <form onSubmit={(e) => void submit(e)} className="text-center">
          <ShieldCheck className="mx-auto size-8 text-primary" />
          <DialogTitle className="mt-2">Admin PIN needed</DialogTitle>
          <p className="mt-1 text-sm text-muted-foreground">{request?.label}</p>
          <input autoFocus type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} aria-label="Admin PIN"
            onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setError(""); }}
            className="mx-auto mt-4 block w-40 rounded-xl border border-input bg-card px-3 py-3 text-center text-2xl tracking-[0.5em]" />
          {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => request?.resolve(false)}>Cancel</Button>
            <Button type="submit" disabled={pin.length < 4 || busy}>{busy ? "Checking…" : "Allow"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
