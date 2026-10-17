import type { TaxOptions } from "./billing";
import type { OrderType, PaymentMode, RestaurantSettings } from "./types";

export type GstMode = "regular" | "composition" | "unregistered";

export const GST_MODES: { v: GstMode; l: string; hint: string }[] = [
  { v: "regular", l: "Regular GST", hint: "Charge CGST + SGST on bills (tax invoice)." },
  { v: "composition", l: "Composition scheme", hint: "No GST on bills; prints a bill of supply." },
  { v: "unregistered", l: "Not registered for GST", hint: "No GST on bills." },
];

/** Restaurant service SAC code. */
export const RESTAURANT_SAC = "996331";

export const ALL_PAYMENT_MODES: PaymentMode[] = ["cash", "upi", "card", "wallet", "credit", "points"];

export function gstModeOf(settings: RestaurantSettings): GstMode {
  return settings.gstMode ?? "regular";
}

/** Swiggy and Zomato pay GST on restaurant orders placed through them (CGST Act section 9(5)). */
export function isAggregator(orderType: OrderType): boolean {
  return orderType === "swiggy" || orderType === "zomato";
}

/** Tax rules for a new bill of this order type under the restaurant's settings. */
export function taxOptionsFor(settings: RestaurantSettings, orderType: OrderType): TaxOptions {
  const exempt = gstModeOf(settings) !== "regular" || (isAggregator(orderType) && (settings.aggregatorGstByOperator ?? true));
  return {
    inclusive: Boolean(settings.pricesIncludeGst),
    exempt,
    roundToRupee: settings.roundToRupee ?? true,
  };
}

/** Why a bill carries no GST, for the printed bill. */
export function exemptionNote(settings: RestaurantSettings, orderType: OrderType): string {
  const mode = gstModeOf(settings);
  if (mode === "composition") return "Composition taxable person, not eligible to collect tax on supplies";
  if (mode === "unregistered") return "Supplier not registered under GST";
  if (isAggregator(orderType)) return "GST on this order is paid by the e-commerce operator under section 9(5)";
  return "";
}

/** GST state codes, for place of supply on GSTR-1. */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
  "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland",
  "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};

/** "17-Meghalaya" from a GSTIN (or a fallback state code). */
export function placeOfSupply(gstin: string | undefined, fallbackCode = "17"): string {
  const code = /^\d{2}/.exec(gstin ?? "")?.[0] ?? fallbackCode;
  return `${code}-${GST_STATES[code] ?? "Unknown"}`;
}
