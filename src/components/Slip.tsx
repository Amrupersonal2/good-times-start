import type { CSSProperties } from "react";
import { billSlip, columnsFor, type Slip } from "@/lib/slip";
import { usePrintConfig } from "@/lib/print-config";
import { useRestaurantSettings } from "@/lib/use-settings";
import type { Order } from "@/lib/types";

/**
 * A slip as Chrome prints it: the same fixed-width lines the thermal printer gets,
 * in a heavy monospace sized so a line fills the paper. Bold by default so thin
 * thermal heads print it dark and clear.
 */
export function SlipView({ slip, qrDataUrl }: { slip: Slip; qrDataUrl?: string | undefined }) {
  const cols = columnsFor(slip.paper);
  const width = slip.paper === 58 ? 48 : 72; // printable mm
  // Monospace characters are about 0.6em wide: size the font so `cols` characters fill the width.
  const font = width / cols / 0.6;
  const base: CSSProperties = { fontSize: `${font}mm`, lineHeight: 1.25, whiteSpace: "pre", fontWeight: 600 };
  return (
    <div className="slip bg-white text-black" style={{ width: `${width}mm`, fontFamily: "'Consolas','Lucida Console','Courier New',monospace" }}>
      {slip.lines.map((line, i) => {
        const style: CSSProperties = { ...base, textAlign: line.align ?? "left", fontWeight: line.bold ? 800 : 600 };
        if (line.size === "big") return <div key={i} style={{ ...style, fontSize: `${font * 2}mm`, lineHeight: 1.15 }}>{line.text || " "}</div>;
        if (line.size === "tall") {
          return (
            <div key={i} style={{ ...style, height: `${font * 2.5}mm` }}>
              <div style={{ transform: "scaleY(2)", transformOrigin: "top" }}>{line.text || " "}</div>
            </div>
          );
        }
        return <div key={i} style={style}>{line.text || " "}</div>;
      })}
      {qrDataUrl ? <img src={qrDataUrl} alt="UPI QR code" width={140} height={140} style={{ display: "block", margin: "2mm auto", width: "32mm", height: "32mm" }} /> : null}
    </div>
  );
}

/** On-screen copy of a bill exactly as this device prints it. */
export function BillSlipPreview({ order }: { order: Order }) {
  const settings = useRestaurantSettings();
  const config = usePrintConfig();
  return (
    <div className="mx-auto w-fit max-w-full overflow-x-auto rounded-lg bg-white p-3 shadow-inner ring-1 ring-border">
      <SlipView slip={billSlip(order, settings, config.paper)} />
    </div>
  );
}
