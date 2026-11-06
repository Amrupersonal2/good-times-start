import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { resolveSyncConflict } from "@/lib/cloud-sync";
import { parseConflicts } from "@/lib/record-versions";

/**
 * Explicit alert when another device changed a record this device also changed
 * and the edits can't be merged automatically. The local copy stays on this
 * device until staff choose; nothing is discarded silently.
 */
export function SyncConflictAlert() {
  const raw = useLiveQuery(() => getDb().meta.get("syncConflicts"), []);
  const conflicts = parseConflicts(raw?.value);
  const [busy, setBusy] = useState<string | null>(null);
  if (!conflicts.length) return null;

  const decide = async (key: string, choice: "mine" | "cloud") => {
    setBusy(key);
    try {
      await resolveSyncConflict(key, choice);
      toast.success(choice === "mine" ? "Your changes will be sent on the next sync" : "Updated to the latest copy");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't resolve this change");
    } finally { setBusy(null); }
  };

  return (
    <div role="alert" className="mx-3 mt-3 space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <p className="flex items-center gap-2 font-semibold text-foreground">
        <AlertTriangle className="size-4 text-destructive" />
        {conflicts.length === 1 ? "A change needs your decision" : `${conflicts.length} changes need your decision`}
      </p>
      {conflicts.map((c) => (
        <div key={c.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background/70 p-2">
          <div className="min-w-0">
            <p className="font-medium text-foreground">{c.label}</p>
            <p className="text-xs text-muted-foreground">{c.reasons.join(" · ")}. Your copy is kept on this device.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy === c.key} onClick={() => void decide(c.key, "cloud")}>Use latest copy</Button>
            <Button size="sm" disabled={busy === c.key} onClick={() => void decide(c.key, "mine")}>Keep my changes</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
