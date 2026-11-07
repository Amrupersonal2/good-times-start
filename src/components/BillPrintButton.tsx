import { forwardRef, useState, type ComponentProps } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { printBill } from "./PrintHost";
import { useStaff } from "@/lib/auth-context";
import { useAppMode } from "@/lib/app-mode";
import { thermalDestination } from "@/lib/print-routing";
import { can, type Action } from "@/lib/permissions";
import { allow } from "@/lib/pin-gate";
import type { Order } from "@/lib/types";
import { hasBillNumber } from "@/lib/bill-numbering";

export interface BillPrintButtonProps extends Omit<ComponentProps<typeof Button>, "onClick"> {
  order: Order;
  action?: Extract<Action, "bill.print" | "bill.reprint" | "bill.reprintOld">;
}
/** App-only saved-bill dispatch; never allocates numbers or changes bill records. */
export const BillPrintButton = forwardRef<HTMLButtonElement, BillPrintButtonProps>(function BillPrintButton({ order, action = order.status === "held" ? "bill.print" : "bill.reprint", children, disabled, size = "icon", variant = "outline", ...props }, ref) {
  const { user } = useStaff();
  const app = useAppMode(user);
  const [busy, setBusy] = useState(false);
  if (thermalDestination(app) === "blocked" || !can(user, action)) return null;
  const print = async () => {
    if (busy) return;
    setBusy(true);
    try { if (await allow(user, action, (hasBillNumber(order) ? `Print bill ${order.billNo}` : "Print running bill"))) await printBill(order); }
    catch { toast.error("Could not send bill to printer. Please try again."); }
    finally { setBusy(false); }
  };
  return <Button ref={ref} size={size} variant={variant} aria-label={(hasBillNumber(order) ? `Print bill ${order.billNo}` : "Print running bill")} title={(hasBillNumber(order) ? `Print bill ${order.billNo}` : "Print running bill")} {...props} disabled={disabled || busy} onClick={() => void print()}><Printer className="size-4" />{children}</Button>;
});