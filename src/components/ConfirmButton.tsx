import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { armed, disarm, press, subscribe } from "@/lib/two-step";
import { cn } from "@/lib/utils";

/**
 * A button that needs two taps. The first tap turns it into a clear
 * "tap again" prompt for four seconds; the second tap does the action. A tap
 * anywhere else, Esc, or waiting cancels it. No pop-up, so it stays fast.
 */
export function ConfirmButton({ id, onConfirm, submit, children, confirm, className, armedClassName, disabled, ariaLabel, title }: {
  /** Unique per action, e.g. "settle-cash". Shortcut keys use the same id. */
  id: string;
  onConfirm?: () => void | Promise<unknown>;
  /** Submit the surrounding form on the second tap (for forms such as day close or purchases). */
  submit?: boolean;
  children: ReactNode;
  /** What the button says while waiting for the second tap. */
  confirm: ReactNode;
  className?: string;
  armedClassName?: string;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
}) {
  const current = useSyncExternalStore(subscribe, armed, () => null);
  const isArmed = current === id;
  const ref = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isArmed) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) disarm(id); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") disarm(id); };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", esc);
    };
  }, [isArmed, id]);
  useEffect(() => () => disarm(id), [id]);
  useEffect(() => { if (disabled) disarm(id); }, [disabled, id]);

  const click = async () => {
    if (busy || !press(id)) return;
    setBusy(true);
    try {
      if (submit) ref.current?.form?.requestSubmit();
      else await onConfirm?.();
    } finally { setBusy(false); }
  };

  return (
    <button ref={ref} type="button" disabled={disabled || busy} onClick={() => void click()} aria-label={isArmed ? undefined : ariaLabel} title={title}
      className={cn(className, isArmed && (armedClassName ?? "ring-2 ring-offset-2 ring-offset-card ring-gold"))}>
      {isArmed ? <span aria-live="assertive" className="contents">{confirm}</span> : children}
    </button>
  );
}

/** Run a shortcut key through the same two steps: first press arms the button, second press does it. */
export function pressShortcut(id: string, action: () => void | Promise<unknown>): void {
  if (press(id)) void action();
}
