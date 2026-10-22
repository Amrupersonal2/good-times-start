import type { OrderType } from "./types";

/**
 * Bills open only from the Tables screen: a table's bill, a running counter
 * bill, or a new counter order. These are the orders that have no table.
 */
export const COUNTER_TYPES: { v: Exclude<OrderType, "dine-in">; l: string }[] = [
  { v: "takeaway", l: "Takeaway" },
  { v: "delivery", l: "Delivery" },
  { v: "swiggy", l: "Swiggy" },
  { v: "zomato", l: "Zomato" },
];

export function isCounterType(value: unknown): value is Exclude<OrderType, "dine-in"> {
  return COUNTER_TYPES.some((t) => t.v === value);
}
