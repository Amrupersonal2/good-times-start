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
  billNo: string;
  orderType: OrderType;
  tableId?: string;
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
  orderId: number;
  billNo: string;
  station: string;
  lines: { name: string; qty: number; note?: string }[];
  status: KotStatus;
  createdAt: number;
}
