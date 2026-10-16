export type OrderType = "dine-in" | "takeaway" | "delivery" | "swiggy" | "zomato";
export type PaymentMode = "cash" | "upi" | "card" | "wallet" | "credit";
export type TableStatus = "free" | "occupied" | "billed" | "reserved";
export type KotStatus = "new" | "preparing" | "ready";

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  price: number;
  veg: boolean;
  gstRate: 0 | 5 | 12 | 18 | 28;
  station: "Tandoor" | "Chinese" | "South Indian" | "Beverages" | "Main Course" | "Desserts";
  available: boolean;
  popular?: boolean;
  stockTracked?: boolean;
}

export interface CartLine {
  itemId: string;
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
  section: "AC" | "Non-AC" | "Rooftop";
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
  orderType?: OrderType;
  billNo: string;
  station: string;
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
  updatedAt?: number;
}
