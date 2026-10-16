export type OrderType = "dine-in" | "takeaway" | "delivery" | "swiggy" | "zomato";
export type PaymentMode = "cash" | "upi" | "card" | "wallet" | "credit";
export type TableStatus = "free" | "occupied" | "billed" | "reserved";
/** "served" hides a ticket from the kitchen screen once it has left the pass. */
export type KotStatus = "new" | "preparing" | "ready" | "served";

export type GstRate = 0 | 5 | 12 | 18 | 28;

/** A priced choice such as Half / Full, or an add-on such as Extra cheese. */
export interface MenuOption {
  id: string;
  name: string;
  price: number;
}

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  /** Base price, or the price of the first portion when portions exist. */
  price: number;
  veg: boolean;
  gstRate: GstRate;
  /** Kitchen station that receives this dish's KOT. */
  station: string;
  available: boolean;
  popular?: boolean;
  stockTracked?: boolean;
  /** Portions; when present the cashier must pick one. */
  variants?: MenuOption[];
  addons?: MenuOption[];
  /** Price overrides by order type, e.g. a higher Swiggy price. Ignored for dishes with portions. */
  prices?: Partial<Record<OrderType, number>>;
}

export interface CartLine {
  /** Identifies the line: the menu item id, plus portion and add-ons when chosen. */
  itemId: string;
  /** Menu item this line came from (for stock); absent on plain lines where it equals itemId. */
  menuItemId?: string;
  variant?: string;
  addons?: { name: string; price: number }[];
  name: string;
  price: number;
  qty: number;
  veg: boolean;
  gstRate: number;
  station: string;
  note?: string;
}

export interface Order {
  id?: number;
  /** Global id shared by every device of the restaurant. Local `id` differs per device. */
  uid?: string;
  billNo: string;
  orderType: OrderType;
  tableId?: string | undefined;
  /** Table name as printed, e.g. "T4"; kept with the bill in case the table is renamed later. */
  tableLabel?: string | undefined;
  lines: CartLine[];
  subtotal: number;
  discountPct: number;
  discountAmt: number;
  cgst: number;
  sgst: number;
  roundOff: number;
  total: number;
  payments: { mode: PaymentMode; amount: number }[];
  status: "held" | "settled" | "void";
  voidReason?: string;
  serviceChargePct?: number;
  serviceCharge?: number;
  customer?: { name?: string; phone?: string };
  /** Who settled or voided the bill, for the staff report. */
  closedBy?: string;
  createdAt: number;
  synced: boolean;
  cloudUserId?: string;
  kotSubmittedQty?: Record<string, number>;
}

export interface CartDraft {
  id: string;
  tableId?: string | undefined;
  lines: CartLine[];
  discountPct: number;
  updatedAt: number;
}

export interface InventoryItem {
  id: string;
  menuItemId: string;
  name: string;
  unit: string;
  quantity: number;
  lowStockThreshold: number;
  tracked: boolean;
  synced: boolean;
}

export interface RestaurantTable {
  id: string;
  label: string;
  section: string;
  seats: number;
  status: TableStatus;
  runningTotal: number;
  since?: number | undefined;
}

export interface Kot {
  id?: number;
  /** Global id shared by every device of the restaurant. */
  uid?: string;
  orderId: number;
  orderUid?: string;
  tableId?: string | undefined;
  tableLabel?: string | undefined;
  orderType?: OrderType;
  billNo: string;
  station: string;
  /** "cancel" tickets tell the station to stop making these items. */
  kind?: "order" | "cancel";
  lines: { itemId?: string; name: string; qty: number; note?: string | undefined }[];
  status: KotStatus;
  createdAt: number;
}

export interface RestaurantSettings {
  name: string;
  legalName?: string;
  address?: string;
  phone?: string;
  gstin?: string;
  fssai?: string;
  upiVpa?: string;
  billFooter?: string;
  /** Optional service charge %, offered per dine-in bill and off by default. */
  serviceChargePct?: number;
  /** Highest discount % cashiers and captains can give. */
  staffDiscountLimit?: number;
  updatedAt?: number;
}
