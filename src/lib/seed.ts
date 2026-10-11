import type { MenuItem, RestaurantTable } from "./types";

export const RESTAURANT = {
  name: "Spice Route Kitchen",
  address: "12, MG Road, Koramangala, Bengaluru 560034",
  gstin: "29ABCDE1234F1Z5",
  fssai: "11224333000123",
  phone: "+91 98765 43210",
  upiVpa: "spiceroute@upi",
};

export const CATEGORIES = ["Starters", "Main Course", "Breads", "Rice & Biryani", "South Indian", "Chinese", "Beverages", "Desserts"];

const m = (id: string, name: string, category: string, price: number, veg: boolean, station: MenuItem["station"], popular = false, gstRate: MenuItem["gstRate"] = 5): MenuItem =>
  ({ id, name, category, price, veg, station, popular, gstRate, available: true });

export const SEED_MENU: MenuItem[] = [
  m("i1", "Paneer Tikka", "Starters", 280, true, "Tandoor", true),
  m("i2", "Chicken 65", "Starters", 320, false, "Chinese", true),
  m("i3", "Hara Bhara Kebab", "Starters", 240, true, "Tandoor"),
  m("i4", "Tandoori Chicken (Half)", "Starters", 340, false, "Tandoor"),
  m("i5", "Paneer Butter Masala", "Main Course", 290, true, "Main Course", true),
  m("i6", "Dal Makhani", "Main Course", 240, true, "Main Course", true),
  m("i7", "Butter Chicken", "Main Course", 360, false, "Main Course", true),
  m("i8", "Kadai Paneer", "Main Course", 280, true, "Main Course"),
  m("i9", "Mutton Rogan Josh", "Main Course", 420, false, "Main Course"),
  m("i10", "Butter Naan", "Breads", 60, true, "Tandoor", true),
  m("i11", "Garlic Naan", "Breads", 70, true, "Tandoor"),
  m("i12", "Tandoori Roti", "Breads", 30, true, "Tandoor"),
  m("i13", "Laccha Paratha", "Breads", 65, true, "Tandoor"),
  m("i14", "Hyderabadi Chicken Biryani", "Rice & Biryani", 340, false, "Main Course", true),
  m("i15", "Veg Dum Biryani", "Rice & Biryani", 260, true, "Main Course"),
  m("i16", "Jeera Rice", "Rice & Biryani", 160, true, "Main Course"),
  m("i17", "Masala Dosa", "South Indian", 120, true, "South Indian", true),
  m("i18", "Idli Sambar", "South Indian", 80, true, "South Indian"),
  m("i19", "Medu Vada", "South Indian", 90, true, "South Indian"),
  m("i20", "Onion Uttapam", "South Indian", 130, true, "South Indian"),
  m("i21", "Veg Hakka Noodles", "Chinese", 190, true, "Chinese"),
  m("i22", "Chilli Paneer", "Chinese", 250, true, "Chinese"),
  m("i23", "Chicken Fried Rice", "Chinese", 230, false, "Chinese"),
  m("i24", "Filter Coffee", "Beverages", 50, true, "Beverages", true),
  m("i25", "Masala Chai", "Beverages", 30, true, "Beverages", true),
  m("i26", "Sweet Lassi", "Beverages", 90, true, "Beverages"),
  m("i27", "Fresh Lime Soda", "Beverages", 80, true, "Beverages"),
  m("i28", "Gulab Jamun (2 pc)", "Desserts", 90, true, "Desserts"),
  m("i29", "Rasmalai", "Desserts", 120, true, "Desserts"),
  m("i30", "Gajar Halwa", "Desserts", 110, true, "Desserts"),
];

export const SEED_TABLES: RestaurantTable[] = [
  ...["T1", "T2", "T3", "T4", "T5", "T6"].map((l) => ({ id: l, label: l, section: "AC" as const, seats: 4, status: "free" as const, runningTotal: 0 })),
  ...["N1", "N2", "N3", "N4"].map((l) => ({ id: l, label: l, section: "Non-AC" as const, seats: 4, status: "free" as const, runningTotal: 0 })),
  ...["R1", "R2", "R3"].map((l) => ({ id: l, label: l, section: "Rooftop" as const, seats: 6, status: "free" as const, runningTotal: 0 })),
];
