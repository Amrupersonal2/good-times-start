import { useState } from "react";
import { Check, Copy, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { printBill, printKots } from "@/components/PrintHost";
import type { PrintConfig, PrintMethod } from "@/lib/print-logic";
import type { Order } from "@/lib/types";

const RAWBT_STORE = "https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter";

/** The Chrome shortcut that makes this computer print bills and KOTs with no print box. */
export function kioskShortcut(origin: string, path: string, os: "windows" | "mac"): string {
  const url = `${origin}${path}`;
  return os === "mac"
    ? `open -na "Google Chrome" --args --kiosk-printing --app="${url}"`
    : `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing --app="${url}"`;
}

/** Test slips: one KOT and one bill, never saved anywhere. */
export function testKot(station: string): Parameters<typeof printKots>[0] {
  const now = Date.now();
  return [{ uid: `test-${now}`, orderId: 0, billNo: "TEST/0001", station, kind: "order", orderType: "dine-in", tableLabel: "Room 7A",
    lines: [{ name: "Masala Bread Omelette", qty: 1 }, { name: "Black Tea", qty: 2, note: "Printer check" }], status: "new", createdAt: now }];
}
export function testBill(): Order {
  return { uid: "test-bill", billNo: "TEST/0001", orderType: "dine-in", tableLabel: "Room 7A",
    lines: [
      { itemId: "t1", name: "Masala Bread Omelette", price: 169, qty: 1, veg: false, gstRate: 5, station: "Kitchen" },
      { itemId: "t2", name: "Black Tea", price: 39, qty: 2, veg: true, gstRate: 5, station: "Kitchen" },
    ],
    subtotal: 247, discountPct: 0, discountAmt: 0, cgst: 0, sgst: 0, roundOff: 0, total: 247, payments: [{ mode: "cash", amount: 247 }],
    status: "settled", createdAt: Date.now(), synced: true, closedBy: "Test print", tax: { exempt: true, inclusive: false, roundToRupee: true } };
}

/**
 * How this device prints with no print box, with the one-time setup for each way.
 * Used in Settings → Printing & KOT and in the waiter app's printer setup.
 */
export function PrinterMethod({ form, patch, appPath, station = "Kitchen" }: {
  form: PrintConfig;
  patch: (p: Partial<PrintConfig>) => void;
  appPath: string;
  station?: string;
}) {
  const android = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
  const mac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shortcut = kioskShortcut(origin, appPath, mac ? "mac" : "windows");
  const [copied, setCopied] = useState(false);
  const choices: { v: PrintMethod; l: string; d: string }[] = [
    { v: "browser", l: "Computer · USB or network printer", d: "Chrome prints straight to this computer's default printer." },
    { v: "rawbt", l: "Android · Bluetooth, Wi‑Fi or USB printer", d: "The free RawBT app prints straight away, no preview." },
  ];
  const copy = () => {
    void navigator.clipboard?.writeText(shortcut).then(() => { setCopied(true); toast.success("Shortcut copied"); window.setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="text-sm font-medium">How this device prints</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="How this device prints">
          {choices.map((c) => (
            <button key={c.v} type="button" role="radio" aria-checked={form.method === c.v} onClick={() => patch({ method: c.v })}
              className={`rounded-xl border p-3 text-left text-sm ${form.method === c.v ? "border-primary bg-primary-tint" : "border-border"}`}>
              <span className="block font-semibold">{c.l}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{c.d}</span>
              {android === (c.v === "rawbt") ? <span className="mt-1 block text-[11px] font-semibold text-primary">Suits this device</span> : null}
            </button>
          ))}
        </div>
      </fieldset>

      {form.method === "browser" ? (
        <ol className="list-decimal space-y-1.5 rounded-xl bg-secondary p-3 pl-7 text-xs leading-relaxed">
          <li>Make the thermal printer this computer's <b>default printer</b> (Windows: Settings → Bluetooth & devices → Printers → the printer → Set as default; turn off "Let Windows manage my default printer"). A network printer is added there by its IP address first.</li>
          <li>Make a desktop shortcut that opens this app with silent printing:
            <code className="mt-1 block break-all rounded-lg bg-card p-2 font-mono text-[11px]">{shortcut}</code>
            <Button size="sm" variant="outline" className="mt-1.5" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy shortcut"}</Button>
          </li>
          <li>Close every Chrome window, then open the POS from that shortcut. Print KOT and Print bill now print at once, with no print box.</li>
        </ol>
      ) : (
        <ol className="list-decimal space-y-1.5 rounded-xl bg-secondary p-3 pl-7 text-xs leading-relaxed">
          <li>Install <a href={RAWBT_STORE} target="_blank" rel="noreferrer" className="font-semibold text-primary underline">RawBT</a> from the Play Store (free).</li>
          <li>In RawBT, connect the printer: Bluetooth (pair it first), Wi‑Fi/LAN (printer's IP address, port 9100) or USB. Choose the ESC/POS driver and the same paper width as below.</li>
          <li>In RawBT's settings, turn off the print preview so slips print straight away.</li>
          <li>Tap a test print below. The first time, Android may ask to open RawBT: choose "Always".</li>
        </ol>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void printKots(testKot(station), "reprint")}><Printer />Test KOT</Button>
        <Button variant="outline" onClick={() => void printBill(testBill())}><Printer />Test bill</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Save first: test prints use this device's saved printer settings.</p>
    </div>
  );
}
