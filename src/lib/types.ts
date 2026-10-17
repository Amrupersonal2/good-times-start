export type OrderType = "dine-in" | "takeaway" | "delivery" | "swiggy" | "zomato";
/** "credit" is an amount the guest pays later (a due); "points" is loyalty points spent. */
export type PaymentMode = "cash" | "upi" | "card" | "wallet" | "credit" | "points";
export type TableStatus = "free" | "occupied" | "billed" | "reserved";
/** "served" hides a ticket from the kitchen screen once it has left the pass. */
export type KotStatus = "new" | "preparing" | "ready" | "served";

export type GstRate = 0 | 5 | 12 | 18 | 28;

/** A priced choice such as Half / Full, or an add-on such as Extra cheese. */
export interface MenuOption {
  id: string;
  name: string;
  price: number;
  /** A portion can differ from its dish, e.g. the Veg version of a pasta. */
  veg?: boolean;
  /** Extra ingredients this portion or add-on uses, on top of the dish's own recipe. */
  recipe?: { materialId: string; qty: number }[];
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
  /** Raw materials used per portion; deducted from stock when the bill settles. */
  recipe?: { materialId: string; qty: number }[];
  /** What comes with the dish, e.g. a breakfast platter's contents. */
  description?: string;
  /** Served only between these times (24h "HH:MM"), e.g. breakfast. */
  hours?: { from: string; to: string };
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
  /** Value before GST after discount (excludes service charge). */
  taxable?: number;
  /** Tax rules this bill was made under. */
  tax?: { inclusive?: boolean; exempt?: boolean; roundToRupee?: boolean };
  customer?: { name?: string; phone?: string; gstin?: string };
  /** Who settled or voided the bill, for the staff report. */
  closedBy?: string;
  feedback?: { rating: 1 | 2 | 3 | 4 | 5; comment?: string; at: number };
  createdAt: number;
  synced: boolean;
  cloudUserId?: string;
  kotSubmittedQty?: Record<string, number>;
}

export interface CartDraft {
  id: string;
  tableId?: string | undefined;
  /** The running bill this draft builds on; a draft for a bill that has since closed is discarded. */
  orderUid?: string | undefined;
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
  /** GST registration type; regular charges CGST + SGST. */
  gstMode?: "regular" | "composition" | "unregistered";
  /** Menu prices already include GST. */
  pricesIncludeGst?: boolean;
  /** Swiggy/Zomato pay GST on their orders (section 9(5)); bills for them carry no GST. Default on. */
  aggregatorGstByOperator?: boolean;
  /** Round bill totals to the rupee (default on). */
  roundToRupee?: boolean;
  /** SAC code for restaurant service, printed on GSTR-1 HSN summary. */
  sac?: string;
  /** Send unsent items to the kitchen automatically when a bill is settled. */
  autoKotOnSettle?: boolean;
  /** Payment buttons shown when settling. */
  paymentModes?: PaymentMode[];
  /** KOT: one ticket per kitchen station (default) or one combined ticket. */
  kotByStation?: boolean;
  /** Text printed at the top of every KOT, e.g. "Kitchen copy". */
  kotHeader?: string;
  /** Menu sections in the order they appear on the printed menu. */
  categoryOrder?: string[];
  /** Loyalty: % of each bill earned back as points (1 point = ₹1). 0 turns loyalty off. */
  loyaltyPct?: number;
  updatedAt?: number;
}

export type StockUnit = "kg" | "g" | "l" | "ml" | "pcs" | "dozen" | "packet";

/** A raw material such as Paneer or Basmati rice. Stock comes from the ledger, not a stored number. */
export interface Material {
  id: string;
  name: string;
  unit: StockUnit;
  /** Warn when stock falls to or below this. */
  lowStockLevel: number;
  /** Last known cost per unit, for valuing stock. */
  costPerUnit?: number;
  archived?: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  gstin?: string;
  note?: string;
}

/**
 * One append-only stock movement. Quantities are signed: purchases add, sales
 * and wastage subtract, and counts add the difference to what was on the books.
 */
export interface StockEntry {
  id: string;
  type: "purchase" | "sale" | "wastage" | "count" | "return";
  at: number;
  items: { materialId: string; qty: number; unitCost?: number }[];
  supplierId?: string;
  /** Supplier invoice number, or the bill number for sales. */
  reference?: string;
  note?: string;
  by?: string;
}

export interface Customer {
  /** Phone number with country code stripped to digits, e.g. "9876543210". */
  id: string;
  phone: string;
  name?: string;
  /** Loyalty points balance comes from bills; this holds manual adjustments only. */
  pointsAdjustment?: number;
  /** Payments received against amounts the guest owed (bills paid as "Due"). */
  duesPaid?: { id: string; amount: number; mode: PaymentMode; at: number; by?: string }[];
  note?: string;
  createdAt: number;
}

/** One counter's cash drawer closed at the end of a day. Id is `${YYYY-MM-DD}:${series}`. */
export interface DayClose {
  id: string;
  day: string;
  series: string;
  openingCash: number;
  expectedCash: number;
  countedCash: number;
  note?: string;
  bills: number;
  net: number;
  closedBy?: string;
  at: number;
}
