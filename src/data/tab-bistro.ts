import type { Material, MenuItem, MenuOption, StockUnit } from "@/lib/types";

/**
 * TAB Bistro by XTSY — full menu with per-portion recipes.
 *
 * Prices are as printed on the menu (before GST). Recipe quantities are
 * standard kitchen estimates per portion, in each material's unit (kg, l or
 * pieces); adjust them in Menu → dish → Recipe to match how your kitchen
 * actually plates each dish. Item recipes hold what every portion uses;
 * a portion's recipe adds to it (so Half/Full and Veg/Chicken/Seafood carry
 * their own main ingredient).
 */

export const TAB_SOURCE = "TAB Bistro by XTSY menu";

/* ---------------- raw materials ---------------- */

type MaterialRow = [id: string, name: string, unit: StockUnit, costPerUnit: number, lowStockLevel: number];

const MATERIAL_ROWS: MaterialRow[] = [
  ["chicken-boneless", "Chicken boneless", "kg", 320, 3],
  ["chicken-curry-cut", "Chicken curry cut (bone-in)", "kg", 240, 4],
  ["chicken-tandoori", "Chicken whole, skinless (tandoori)", "kg", 250, 3],
  ["chicken-lollipop", "Chicken lollipop (drumettes)", "pcs", 18, 24],
  ["chicken-wings", "Chicken wings", "pcs", 12, 24],
  ["chicken-sausage", "Chicken sausage", "pcs", 22, 10],
  ["prawns", "Prawns, cleaned", "kg", 650, 1],
  ["seafood-mix", "Seafood mix (prawn, squid, fish)", "kg", 560, 1],
  ["crab", "Crab pieces", "pcs", 30, 10],
  ["octopus", "Octopus pieces", "pcs", 45, 10],
  ["eggs", "Eggs", "pcs", 7, 30],
  ["paneer", "Paneer", "kg", 380, 2],
  ["mushroom", "Mushroom (button)", "kg", 220, 2],
  ["broccoli", "Broccoli", "kg", 200, 1],
  ["milk", "Milk", "l", 60, 10],
  ["curd", "Curd", "kg", 90, 3],
  ["cream", "Fresh cream", "l", 260, 2],
  ["butter", "Butter", "kg", 520, 2],
  ["cheese", "Cheese (processed / mozzarella)", "kg", 480, 2],
  ["ghee", "Ghee", "kg", 650, 1],
  ["ice-cream", "Ice cream (chocolate, vanilla, strawberry)", "l", 280, 3],
  ["basmati", "Basmati rice", "kg", 110, 10],
  ["rice", "Rice (regular)", "kg", 55, 10],
  ["maida", "Maida (refined flour)", "kg", 40, 10],
  ["atta", "Atta (wheat flour)", "kg", 42, 10],
  ["poha", "Poha", "kg", 60, 2],
  ["bread", "Bread slices", "pcs", 3, 40],
  ["noodles", "Hakka noodles", "kg", 140, 3],
  ["pasta", "Pasta (penne)", "kg", 180, 2],
  ["parotta", "Kerala parotta", "pcs", 12, 20],
  ["urad-whole", "Black urad (whole)", "kg", 140, 2],
  ["rajma", "Rajma", "kg", 150, 1],
  ["toor-dal", "Toor dal", "kg", 150, 3],
  ["moong-dal", "Moong dal", "kg", 130, 2],
  ["sweet-corn", "Sweet corn kernels", "kg", 160, 1],
  ["peanuts", "Peanuts", "kg", 140, 1],
  ["cashew", "Cashew", "kg", 900, 0.5],
  ["papad", "Papad", "pcs", 3, 20],
  ["potato", "Potato", "kg", 35, 10],
  ["fries", "French fries (frozen)", "kg", 180, 5],
  ["onion", "Onion", "kg", 40, 15],
  ["tomato", "Tomato", "kg", 40, 10],
  ["capsicum", "Capsicum", "kg", 80, 3],
  ["cabbage", "Cabbage", "kg", 30, 3],
  ["carrot", "Carrot", "kg", 50, 3],
  ["beans", "French beans", "kg", 70, 2],
  ["peas", "Green peas (frozen)", "kg", 120, 2],
  ["spring-onion", "Spring onion", "kg", 100, 1],
  ["ginger-garlic", "Ginger-garlic paste", "kg", 180, 2],
  ["garlic", "Garlic", "kg", 200, 1],
  ["green-chilli", "Green chilli", "kg", 100, 0.5],
  ["coriander", "Coriander leaves", "kg", 120, 0.5],
  ["mint", "Mint leaves", "kg", 150, 0.5],
  ["lemon", "Lemon", "pcs", 5, 30],
  ["fruits", "Seasonal fruits", "kg", 120, 5],
  ["oil", "Refined oil", "l", 160, 10],
  ["soy-sauce", "Soy sauce", "l", 120, 2],
  ["chilli-sauce", "Chilli sauce", "l", 110, 2],
  ["schezwan", "Schezwan sauce", "kg", 220, 2],
  ["vinegar", "Vinegar", "l", 60, 1],
  ["cornflour", "Cornflour", "kg", 90, 2],
  ["ketchup", "Tomato ketchup", "kg", 140, 2],
  ["honey", "Honey", "kg", 450, 0.5],
  ["mayo", "Mayonnaise", "kg", 240, 1],
  ["maple", "Maple syrup", "l", 900, 0.3],
  ["peri-peri", "Peri peri seasoning", "kg", 600, 0.2],
  ["spices", "Indian spice mix (garam masala, chilli, turmeric, cumin)", "kg", 500, 1],
  ["tandoori-masala", "Tandoori masala", "kg", 500, 0.5],
  ["sugar", "Sugar", "kg", 45, 5],
  ["tea", "Assam tea leaves", "kg", 450, 1],
  ["coffee", "Coffee (espresso beans / powder)", "kg", 1200, 0.5],
  ["soda", "Soda", "l", 40, 6],
  ["lychee", "Lychee crush", "l", 450, 0.5],
  ["passion", "Passion fruit crush", "l", 500, 0.5],
  ["green-apple", "Green apple syrup", "l", 450, 0.5],
  ["kiwi", "Kiwi crush", "l", 500, 0.5],
  ["pineapple-juice", "Pineapple juice", "l", 160, 1],
  ["coconut-cream", "Coconut cream", "l", 300, 0.5],
  ["blue-curacao", "Blue curacao syrup", "l", 450, 0.5],
  ["orange-juice", "Orange juice", "l", 150, 1],
  ["grenadine", "Grenadine syrup", "l", 420, 0.5],
  ["choco-syrup", "Chocolate syrup", "l", 300, 1],
  ["caramel", "Caramel syrup", "l", 400, 0.5],
  ["strawberry-crush", "Strawberry crush", "l", 400, 0.5],
  ["oreo", "Oreo biscuits", "pcs", 3, 40],
  ["kitkat", "KitKat bar", "pcs", 25, 10],
  ["dry-fruits", "Dry fruits & nuts (mixed)", "kg", 900, 0.5],
  ["dates", "Dates", "kg", 300, 0.5],
  ["choco-chips", "Chocolate chips", "kg", 600, 0.3],
  ["brownie", "Brownie (baked)", "pcs", 45, 8],
  ["kataifi", "Kataifi pastry", "kg", 700, 1],
  ["pistachio", "Pistachio", "kg", 1800, 0.2],
  ["water-500", "Drinking water 500 ml", "pcs", 7, 24],
  ["water-1l", "Drinking water 1 L", "pcs", 12, 24],
];

export const TAB_MATERIALS: Material[] = MATERIAL_ROWS.map(([id, name, unit, costPerUnit, lowStockLevel]) => ({
  id: `tab-m-${id}`, name, unit, costPerUnit, lowStockLevel,
}));

/* ---------------- recipe building blocks (per portion) ---------------- */

type Mix = Record<string, number>;

/** Combine recipe parts; quantities of the same material add up. */
function mix(...parts: Mix[]): Mix {
  const out: Mix = {};
  for (const part of parts) for (const [k, v] of Object.entries(part)) out[k] = Math.round(((out[k] ?? 0) + v) * 10000) / 10000;
  return out;
}
function scale(part: Mix, factor: number): Mix {
  return Object.fromEntries(Object.entries(part).map(([k, v]) => [k, Math.round(v * factor * 10000) / 10000]));
}
function toRecipe(part: Mix): { materialId: string; qty: number }[] {
  return Object.entries(part).filter(([, q]) => q > 0).map(([id, qty]) => ({ materialId: `tab-m-${id}`, qty }));
}

const B = {
  batter: { maida: 0.02, cornflour: 0.025, "ginger-garlic": 0.005, oil: 0.04 },
  indoChinese: { onion: 0.04, capsicum: 0.04, "spring-onion": 0.01, garlic: 0.008, "green-chilli": 0.005, "soy-sauce": 0.01, "chilli-sauce": 0.015, vinegar: 0.005, cornflour: 0.01, oil: 0.02 },
  schezwan: { onion: 0.04, capsicum: 0.04, "spring-onion": 0.01, garlic: 0.008, "soy-sauce": 0.008, schezwan: 0.04, vinegar: 0.004, cornflour: 0.01, oil: 0.02 },
  kungPao: { onion: 0.04, capsicum: 0.04, "spring-onion": 0.01, garlic: 0.01, "soy-sauce": 0.012, "chilli-sauce": 0.01, peanuts: 0.02, sugar: 0.004, cornflour: 0.01, oil: 0.02 },
  gravy: { cornflour: 0.015, "soy-sauce": 0.005, "spring-onion": 0.005 },
  masala: { onion: 0.1, tomato: 0.1, "ginger-garlic": 0.015, oil: 0.02, spices: 0.008, coriander: 0.003 },
  makhani: { tomato: 0.15, butter: 0.02, cream: 0.03, cashew: 0.01, spices: 0.006, sugar: 0.005, "ginger-garlic": 0.01 },
  tandoori: { curd: 0.06, "tandoori-masala": 0.012, "ginger-garlic": 0.01, oil: 0.01, lemon: 0.25, butter: 0.01 },
  malai: { cream: 0.04, cheese: 0.015, cashew: 0.01, "ginger-garlic": 0.008, lemon: 0.25, butter: 0.01 },
  vegMix: { carrot: 0.03, beans: 0.03, peas: 0.02, cabbage: 0.03, capsicum: 0.02 },
  vegSaute: { carrot: 0.04, beans: 0.04, broccoli: 0.04, butter: 0.01 },
  soup: { cornflour: 0.012, "spring-onion": 0.005, garlic: 0.003 },
  shake: { milk: 0.25, "ice-cream": 0.08, sugar: 0.015 },
  mojito: { lemon: 0.5, mint: 0.005, sugar: 0.02, soda: 0.2 },
  omeletteSide: { bread: 2, butter: 0.01 },
  biryani: { basmati: 0.15, onion: 0.08, curd: 0.05, ghee: 0.015, spices: 0.01, mint: 0.003, oil: 0.01 },
  friedRice: { basmati: 0.1, oil: 0.02, garlic: 0.01, "spring-onion": 0.01, "soy-sauce": 0.008, carrot: 0.02, beans: 0.02, cabbage: 0.02 },
  noodles: { noodles: 0.1, oil: 0.025, garlic: 0.01, "spring-onion": 0.01, "soy-sauce": 0.01, cabbage: 0.03, carrot: 0.02, capsicum: 0.02 },
} satisfies Record<string, Mix>;

/** Veg / Chicken / Seafood portions that add their main ingredient. */
function proteinPortions(id: string, prices: [number, number, number], amounts: { veg: Mix; chicken: Mix; seafood: Mix } = { veg: { mushroom: 0.04, broccoli: 0.03, ...B.vegMix }, chicken: { "chicken-boneless": 0.08 }, seafood: { "seafood-mix": 0.08 } }): MenuOption[] {
  return [
    { id: `${id}-veg`, name: "Veg", price: prices[0], veg: true, recipe: toRecipe(amounts.veg) },
    { id: `${id}-chicken`, name: "Chicken", price: prices[1], veg: false, recipe: toRecipe(amounts.chicken) },
    { id: `${id}-seafood`, name: "Seafood", price: prices[2], veg: false, recipe: toRecipe(amounts.seafood) },
  ];
}

/* ---------------- add-on sets, as printed per section ---------------- */

const opt = (id: string, name: string, price: number, recipe?: Mix): MenuOption => ({ id, name, price, ...(recipe ? { recipe: toRecipe(recipe) } : {}) });

const ADDONS = {
  sugar: [opt("extra-sugar", "Extra sugar", 10, { sugar: 0.01 }), opt("no-sugar", "No sugar", 0)],
  shake: [opt("choco-syrup", "Choco syrup", 20, { "choco-syrup": 0.02 }), opt("ice-cream", "Ice cream", 50, { "ice-cream": 0.08 }), opt("oreo-crunch", "Oreo crunches", 25, { oreo: 2 })],
  snack: [opt("peri-peri", "Peri peri", 15, { "peri-peri": 0.005 }), opt("onions", "Onions", 30, { onion: 0.05 }), opt("extra-peanuts", "Extra peanuts", 40, { peanuts: 0.04 })],
  dessert: [opt("choco-chips", "Choco chips", 25, { "choco-chips": 0.015 }), opt("choco-syrup", "Choco syrup", 20, { "choco-syrup": 0.02 }), opt("oreo-crunch", "Oreo crunches", 25, { oreo: 2 }), opt("ice-cream", "Ice cream", 50, { "ice-cream": 0.08 })],
  bread: [opt("extra-butter", "Extra butter", 20, { butter: 0.01 }), opt("extra-cheese", "Extra cheese", 25, { cheese: 0.02 })],
  seafood: [opt("crab", "Crab (per pc)", 50, { crab: 1 }), opt("prawns", "Prawns (2 pc)", 80, { prawns: 0.04 }), opt("octopus", "Octopus (per pc)", 80, { octopus: 1 })],
  eggSeafood: [opt("fried-egg", "Fried egg", 40, { eggs: 1, oil: 0.005 }), opt("poached-egg", "Poached egg", 40, { eggs: 1 }), opt("crab", "Crab (per pc)", 50, { crab: 1 }), opt("prawns", "Prawns (2 pc)", 80, { prawns: 0.04 }), opt("octopus", "Octopus (per pc)", 80, { octopus: 1 })],
};

/* ---------------- menu ---------------- */

const STATION = { bev: "Beverages", tandoor: "Tandoor", chinese: "Chinese", indian: "Indian", conti: "Continental", dessert: "Desserts" } as const;
const BREAKFAST_HOURS = { from: "08:45", to: "10:45" };

interface Dish {
  name: string;
  price: number;
  veg: boolean;
  recipe?: Mix;
  variants?: MenuOption[];
  addons?: MenuOption[];
  popular?: boolean;
  description?: string;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const SECTIONS: { category: string; station: string; hours?: { from: string; to: string }; dishes: Dish[] }[] = [
  {
    category: "Assam Tea & Coffee", station: STATION.bev, dishes: [
      { name: "Black Tea", price: 39, veg: true, recipe: { tea: 0.004, sugar: 0.01 }, addons: ADDONS.sugar },
      { name: "Red Tea", price: 39, veg: true, recipe: { tea: 0.004, sugar: 0.01 }, addons: ADDONS.sugar },
      { name: "Lemon Honey Tea", price: 39, veg: true, recipe: { tea: 0.003, lemon: 0.25, honey: 0.015 }, addons: ADDONS.sugar },
      { name: "Milk Chai", price: 59, veg: true, popular: true, recipe: { tea: 0.005, milk: 0.12, sugar: 0.012 }, addons: ADDONS.sugar },
      { name: "Espresso", price: 69, veg: true, recipe: { coffee: 0.009 }, addons: ADDONS.sugar },
      { name: "Cappuccino", price: 99, veg: true, recipe: { coffee: 0.009, milk: 0.15, sugar: 0.01 }, addons: ADDONS.sugar },
    ],
  },
  {
    category: "Lemonades", station: STATION.bev, dishes: [
      { name: "Fresh Lime", price: 129, veg: true, recipe: { lemon: 1 }, addons: [ADDONS.sugar[0]!],
        variants: [opt("fresh-lime-sweet", "Sweet", 129, { sugar: 0.03 }), opt("fresh-lime-salt", "Salt", 129)] },
      { name: "Fresh Lemon Soda", price: 149, veg: true, recipe: { lemon: 1, soda: 0.25 }, addons: [ADDONS.sugar[0]!],
        variants: [opt("lemon-soda-sweet", "Sweet", 149, { sugar: 0.03 }), opt("lemon-soda-salt", "Salt", 149)] },
      { name: "Fresh Lemon Mint", price: 169, veg: true, recipe: { lemon: 1, mint: 0.006, sugar: 0.03, soda: 0.2 }, addons: [ADDONS.sugar[0]!] },
      { name: "Drinking Water", price: 12, veg: true,
        variants: [opt("water-500ml", "500 ml", 12, { "water-500": 1 }), opt("water-1l", "1 L", 24, { "water-1l": 1 })] },
    ],
  },
  {
    category: "Mocktails & Mojitos", station: STATION.bev, dishes: [
      { name: "Virgin Mojito", price: 149, veg: true, popular: true, recipe: B.mojito },
      { name: "Lychee Fruit Mojito", price: 169, veg: true, recipe: mix(B.mojito, { lychee: 0.04 }) },
      { name: "Passion Fruit Mojito", price: 189, veg: true, recipe: mix(B.mojito, { passion: 0.04 }) },
      { name: "Green Apple Mojito", price: 189, veg: true, recipe: mix(B.mojito, { "green-apple": 0.04 }) },
      { name: "Oh Kiwi Rita", price: 199, veg: true, recipe: { kiwi: 0.05, lemon: 0.5, sugar: 0.01, soda: 0.15 } },
      { name: "Pina Colada", price: 199, veg: true, recipe: { "pineapple-juice": 0.15, "coconut-cream": 0.05, cream: 0.02, sugar: 0.01 } },
      { name: "XTSY Blue Lagoon", price: 199, veg: true, recipe: { "blue-curacao": 0.04, lemon: 0.5, soda: 0.2, sugar: 0.01 } },
      { name: "Awesome Shillong", price: 229, veg: true, recipe: { "orange-juice": 0.12, grenadine: 0.02, lemon: 0.5, soda: 0.1, mint: 0.003 } },
    ],
  },
  {
    category: "Signature Beverages", station: STATION.bev, dishes: [
      { name: "Chocolate Shake", price: 189, veg: true, recipe: mix(B.shake, { "choco-syrup": 0.04 }), addons: ADDONS.shake },
      { name: "Oreo Shake", price: 199, veg: true, recipe: mix(B.shake, { oreo: 4 }), addons: ADDONS.shake },
      { name: "Caramel KitKat Shake", price: 229, veg: true, recipe: mix(B.shake, { caramel: 0.03, kitkat: 1 }), addons: ADDONS.shake },
      { name: "Strawberry Shake", price: 199, veg: true, recipe: mix(B.shake, { "strawberry-crush": 0.05 }), addons: ADDONS.shake },
      { name: "Arabian Fruit & Nut Shake", price: 289, veg: true, recipe: mix(B.shake, { dates: 0.04, "dry-fruits": 0.03, honey: 0.01 }), addons: ADDONS.shake },
      { name: "Cold Coffee", price: 229, veg: true, popular: true, recipe: { milk: 0.25, coffee: 0.01, sugar: 0.02, "ice-cream": 0.06 }, addons: ADDONS.shake },
    ],
  },
  {
    category: "Breakfast & Bites", station: STATION.conti, hours: BREAKFAST_HOURS, dishes: [
      { name: "North Indian Poha", price: 139, veg: true, recipe: { poha: 0.08, onion: 0.03, potato: 0.03, peanuts: 0.01, oil: 0.01, lemon: 0.25, coriander: 0.002, spices: 0.002 } },
      { name: "Masala Omelette", price: 139, veg: false, recipe: mix({ eggs: 3, onion: 0.03, tomato: 0.02, "green-chilli": 0.003, oil: 0.01, coriander: 0.002 }, B.omeletteSide) },
      { name: "Italian Cheese Omelette", price: 149, veg: false, recipe: mix({ eggs: 3, cheese: 0.03, capsicum: 0.02 }, B.omeletteSide) },
      { name: "Mushroom Cheese Omelette", price: 169, veg: false, recipe: mix({ eggs: 3, mushroom: 0.04, cheese: 0.03 }, B.omeletteSide) },
      { name: "Chicken Cheese Omelette", price: 189, veg: false, recipe: mix({ eggs: 3, "chicken-boneless": 0.05, cheese: 0.03 }, B.omeletteSide) },
      { name: "Bread Omelette", price: 169, veg: false, recipe: { eggs: 2, bread: 4, butter: 0.015, onion: 0.02, oil: 0.005 } },
      { name: "Masala Bread Omelette", price: 189, veg: false, recipe: { eggs: 2, bread: 4, butter: 0.015, onion: 0.03, tomato: 0.02, "green-chilli": 0.003, cheese: 0.015, spices: 0.002 } },
      { name: "Aloo Paratha", price: 129, veg: true, recipe: { atta: 0.1, potato: 0.12, spices: 0.004, butter: 0.015, curd: 0.05 } },
      { name: "Onion Paratha", price: 139, veg: true, recipe: { atta: 0.1, onion: 0.08, "green-chilli": 0.003, spices: 0.004, butter: 0.015, curd: 0.05 } },
      { name: "Paneer Paratha", price: 169, veg: true, recipe: { atta: 0.1, paneer: 0.07, spices: 0.004, butter: 0.015, curd: 0.05 } },
      { name: "Pancake with Maple Syrup", price: 179, veg: false, recipe: { maida: 0.08, milk: 0.1, eggs: 1, sugar: 0.015, butter: 0.015, maple: 0.03 } },
      { name: "Pancake Sundae with Ice Cream", price: 269, veg: false, recipe: { maida: 0.08, milk: 0.1, eggs: 1, sugar: 0.015, butter: 0.015, "ice-cream": 0.1, "choco-syrup": 0.02 } },
      { name: "American Breakfast", price: 389, veg: false,
        description: "English vegetables sauté, eggs (fried or poached), chicken sausage, grilled bread, honey & butter, seasonal fruits",
        recipe: mix(B.vegSaute, { eggs: 2, "chicken-sausage": 2, bread: 2, honey: 0.015, butter: 0.01, fruits: 0.1 }),
        variants: [opt("american-fried", "Fried eggs", 389, { oil: 0.005 }), opt("american-poached", "Poached eggs", 389)] },
      { name: "English Breakfast", price: 329, veg: false,
        description: "English vegetables sauté, fried chicken (regular or peri-peri), mayonnaise, fried bread",
        recipe: mix(B.vegSaute, B.batter, { "chicken-boneless": 0.12, mayo: 0.03, bread: 2, oil: 0.01 }),
        variants: [opt("english-regular", "Regular chicken", 329), opt("english-peri", "Peri-peri chicken", 329, { "peri-peri": 0.005 })] },
    ],
  },
  {
    category: "Soups", station: STATION.chinese, dishes: [
      { name: "Lemon Coriander Soup (Veg)", price: 149, veg: true, recipe: mix(B.soup, { cabbage: 0.02, carrot: 0.02, beans: 0.01, lemon: 0.5, coriander: 0.005 }) },
      { name: "Sweet Corn Soup (Veg)", price: 159, veg: true, recipe: mix(B.soup, { "sweet-corn": 0.05, carrot: 0.01, sugar: 0.003 }) },
      { name: "Hot & Sour Soup (Veg)", price: 169, veg: true, recipe: mix(B.soup, B.vegMix, { "soy-sauce": 0.01, vinegar: 0.01, "chilli-sauce": 0.01 }) },
      { name: "Manchow Soup (Veg)", price: 169, veg: true, recipe: mix(B.soup, B.vegMix, { "soy-sauce": 0.01, noodles: 0.02, oil: 0.02 }) },
      { name: "Cream of Tomato", price: 199, veg: true, recipe: { tomato: 0.25, butter: 0.01, cream: 0.03, sugar: 0.005, bread: 1, cornflour: 0.005 } },
      { name: "Lemon Coriander Soup (Non Veg)", price: 159, veg: false, recipe: mix(B.soup, { cabbage: 0.02, carrot: 0.02, lemon: 0.5, coriander: 0.005, "chicken-boneless": 0.04 }) },
      { name: "Sweet Corn Soup (Non Veg)", price: 169, veg: false, recipe: mix(B.soup, { "sweet-corn": 0.05, sugar: 0.003, "chicken-boneless": 0.04, eggs: 0.5 }) },
      { name: "Hot & Sour Soup (Non Veg)", price: 179, veg: false, recipe: mix(B.soup, scale(B.vegMix, 0.5), { "soy-sauce": 0.01, vinegar: 0.01, "chilli-sauce": 0.01, "chicken-boneless": 0.04 }) },
      { name: "Manchow Soup (Non Veg)", price: 179, veg: false, recipe: mix(B.soup, scale(B.vegMix, 0.5), { "soy-sauce": 0.01, noodles: 0.02, oil: 0.02, "chicken-boneless": 0.04 }) },
      { name: "Clear Soup (Non Veg)", price: 159, veg: false, recipe: mix(B.soup, { "chicken-boneless": 0.05, cabbage: 0.02, carrot: 0.02, beans: 0.01 }) },
    ],
  },
  {
    category: "Non Veg Appetizers", station: STATION.chinese, dishes: [
      { name: "Crispy Chicken 65", price: 299, veg: false, popular: true, recipe: mix(B.batter, { "chicken-boneless": 0.22, curd: 0.02, spices: 0.008, "ginger-garlic": 0.01, oil: 0.01 }) },
      { name: "Drums of Heaven", price: 369, veg: false, recipe: {},
        variants: [
          opt("drums-6", "6 pc", 369, mix(scale(B.batter, 1.5), { "chicken-lollipop": 6, "chilli-sauce": 0.03, "soy-sauce": 0.01, garlic: 0.01, "spring-onion": 0.01 })),
          opt("drums-12", "12 pc", 739, mix(scale(B.batter, 3), { "chicken-lollipop": 12, "chilli-sauce": 0.06, "soy-sauce": 0.02, garlic: 0.02, "spring-onion": 0.02 })),
        ] },
      { name: "Wings of Heaven", price: 349, veg: false, recipe: {},
        variants: [
          opt("wings-6", "6 pc", 349, mix(scale(B.batter, 1.5), { "chicken-wings": 6, "chilli-sauce": 0.03, "soy-sauce": 0.01, garlic: 0.01, honey: 0.01 })),
          opt("wings-12", "12 pc", 699, mix(scale(B.batter, 3), { "chicken-wings": 12, "chilli-sauce": 0.06, "soy-sauce": 0.02, garlic: 0.02, honey: 0.02 })),
        ] },
      { name: "Hot Chilli Prawns", price: 389, veg: false, recipe: mix(B.batter, B.indoChinese, { prawns: 0.18 }) },
      { name: "Prawns Kung Pao", price: 389, veg: false, recipe: mix(B.batter, B.kungPao, { prawns: 0.18 }) },
      { name: "Prawns Hot Schezwan", price: 389, veg: false, recipe: mix(B.batter, B.schezwan, { prawns: 0.18 }) },
    ],
  },
  {
    category: "Veg Appetizers", station: STATION.chinese, dishes: [
      { name: "Paneer Manchurian Dry", price: 279, veg: true, recipe: mix(B.batter, B.indoChinese, { paneer: 0.18 }) },
      { name: "Paneer Hot Schezwan Dry", price: 279, veg: true, recipe: mix(B.batter, B.schezwan, { paneer: 0.18 }) },
      { name: "Paneer Fusion Kung Pao", price: 279, veg: true, recipe: mix(B.batter, B.kungPao, { paneer: 0.18 }) },
      { name: "Mushroom Manchurian Dry", price: 289, veg: true, recipe: mix(B.batter, B.indoChinese, { mushroom: 0.2 }) },
      { name: "Mushroom Hot Schezwan Dry", price: 289, veg: true, recipe: mix(B.batter, B.schezwan, { mushroom: 0.2 }) },
      { name: "Mushroom Kung Pao", price: 289, veg: true, recipe: mix(B.batter, B.kungPao, { mushroom: 0.2 }) },
    ],
  },
  {
    category: "Tandoori Appetizers", station: STATION.tandoor, dishes: [
      { name: "Tandoori Paneer Tikka", price: 329, veg: true, recipe: mix(B.tandoori, { paneer: 0.2, capsicum: 0.04, onion: 0.04 }) },
      { name: "Tandoori Mushroom Tikka", price: 329, veg: true, recipe: mix(B.tandoori, { mushroom: 0.22, capsicum: 0.04, onion: 0.04 }) },
      { name: "Tandoori Malai Broccoli", price: 299, veg: true, recipe: mix(B.malai, { broccoli: 0.25 }) },
      { name: "Tandoori Chicken", price: 399, veg: false, popular: true, recipe: {},
        variants: [
          opt("tandoori-chicken-half", "Half", 399, mix(B.tandoori, { "chicken-tandoori": 0.45, onion: 0.03 })),
          opt("tandoori-chicken-full", "Full", 789, mix(scale(B.tandoori, 2), { "chicken-tandoori": 0.9, onion: 0.06 })),
        ] },
      { name: "Tandoori Chicken Tikka", price: 329, veg: false, recipe: mix(B.tandoori, { "chicken-boneless": 0.22, onion: 0.03 }) },
      { name: "Tandoori Prawns", price: 389, veg: false, recipe: mix(B.tandoori, { prawns: 0.2 }) },
    ],
  },
  {
    category: "Indian Gravies - Veg", station: STATION.indian, dishes: [
      { name: "Mixed Vegetable Gravy", price: 299, veg: true, recipe: mix(B.masala, scale(B.vegMix, 2), { cream: 0.01 }) },
      { name: "Matar Mushroom Masala", price: 329, veg: true, recipe: mix(B.masala, { mushroom: 0.15, peas: 0.06 }) },
      { name: "Paneer Butter Masala", price: 329, veg: true, popular: true, recipe: mix(B.makhani, { paneer: 0.18 }) },
      { name: "Paneer Lababdar", price: 329, veg: true, recipe: mix(B.masala, { paneer: 0.18, butter: 0.01, cream: 0.03, cashew: 0.01 }) },
      { name: "Kadhai Paneer", price: 329, veg: true, recipe: mix(B.masala, { paneer: 0.18, capsicum: 0.06 }) },
    ],
  },
  {
    category: "Indian Gravies - Non Veg", station: STATION.indian, dishes: [
      { name: "Chicken Butter Masala", price: 329, veg: false, popular: true, recipe: mix(B.makhani, scale(B.tandoori, 0.5), { "chicken-boneless": 0.22 }) },
      { name: "Chicken Tikka Masala", price: 329, veg: false, recipe: mix(B.masala, scale(B.tandoori, 0.5), { "chicken-boneless": 0.22, capsicum: 0.03, cream: 0.02 }) },
      { name: "Kadhai Chicken", price: 329, veg: false, recipe: mix(B.masala, { "chicken-curry-cut": 0.28, capsicum: 0.06 }) },
      { name: "XTSY Chicken Kosha", price: 329, veg: false, recipe: mix(B.masala, { "chicken-curry-cut": 0.3, onion: 0.08, spices: 0.006, oil: 0.02 }) },
      { name: "Chicken Curry", price: 299, veg: false, recipe: mix(B.masala, { "chicken-curry-cut": 0.28 }) },
    ],
  },
  {
    category: "Dal Specials", station: STATION.indian, dishes: [
      { name: "XTSY Spl. Dal Makhani", price: 299, veg: true, recipe: { "urad-whole": 0.07, rajma: 0.015, butter: 0.02, cream: 0.03, tomato: 0.06, "ginger-garlic": 0.008, spices: 0.005 } },
      { name: "Yellow Dal Tadka", price: 269, veg: true, recipe: { "toor-dal": 0.09, ghee: 0.01, onion: 0.03, tomato: 0.04, garlic: 0.006, spices: 0.004, coriander: 0.002 } },
    ],
  },
  {
    category: "Hot Tandoori Breads", station: STATION.tandoor, dishes: [
      { name: "Tandoori Roti", price: 39, veg: true, recipe: { atta: 0.06 }, addons: ADDONS.bread,
        variants: [opt("roti-plain", "Plain", 39), opt("roti-butter", "Butter", 49, { butter: 0.008 })] },
      { name: "Laccha Paratha", price: 49, veg: true, recipe: { atta: 0.08, ghee: 0.01 }, addons: ADDONS.bread,
        variants: [opt("laccha-plain", "Plain", 49), opt("laccha-butter", "Butter", 59, { butter: 0.008 })] },
      { name: "Naan", price: 59, veg: true, popular: true, recipe: { maida: 0.08, curd: 0.01, milk: 0.01 }, addons: ADDONS.bread,
        variants: [opt("naan-plain", "Plain", 59), opt("naan-butter", "Butter", 69, { butter: 0.008 })] },
      { name: "Garlic Naan", price: 69, veg: true, recipe: { maida: 0.08, curd: 0.01, garlic: 0.008, butter: 0.01, coriander: 0.002 }, addons: ADDONS.bread },
      { name: "Kulcha", price: 89, veg: true, recipe: { maida: 0.09, curd: 0.01 }, addons: ADDONS.bread },
      { name: "Onion Kulcha", price: 99, veg: true, recipe: { maida: 0.09, curd: 0.01, onion: 0.04 }, addons: ADDONS.bread },
      { name: "Masala Kulcha", price: 129, veg: true, recipe: { maida: 0.09, curd: 0.01, potato: 0.06, onion: 0.02, spices: 0.003 }, addons: ADDONS.bread },
      { name: "Cheese Kulcha", price: 139, veg: true, recipe: { maida: 0.09, curd: 0.01, cheese: 0.03 }, addons: ADDONS.bread },
    ],
  },
  {
    category: "Pulao & Rice", station: STATION.indian, dishes: [
      { name: "Jeera Rice", price: 139, veg: true, recipe: { basmati: 0.12, ghee: 0.01, spices: 0.002 } },
      { name: "Steamed Rice", price: 99, veg: true, recipe: { basmati: 0.12 } },
      { name: "Ghee Rice", price: 169, veg: true, recipe: { basmati: 0.12, ghee: 0.025, cashew: 0.008, onion: 0.02 } },
      { name: "Veg Pulao", price: 199, veg: true, recipe: mix(B.vegMix, { basmati: 0.12, ghee: 0.015, spices: 0.003 }) },
      { name: "XTSY Spl. Dal Khichdi", price: 259, veg: true, recipe: mix(scale(B.vegMix, 0.5), { rice: 0.08, "moong-dal": 0.06, ghee: 0.015, spices: 0.003 }) },
    ],
  },
  {
    category: "XTSY Dum Biryani", station: STATION.indian, dishes: [
      { name: "XTSY Egg Biryani", price: 299, veg: false, recipe: mix(B.biryani, { eggs: 2 }) },
      { name: "XTSY Chicken Biryani", price: 329, veg: false, popular: true, recipe: mix(B.biryani, { "chicken-curry-cut": 0.25 }) },
      { name: "XTSY Chicken Mandi Biryani", price: 639, veg: false, popular: true, recipe: {},
        variants: [
          opt("mandi-half", "Half (serves 2)", 639, { basmati: 0.3, "chicken-curry-cut": 0.5, onion: 0.1, ghee: 0.03, spices: 0.015, "dry-fruits": 0.01, oil: 0.02 }),
          opt("mandi-full", "Full (serves 4)", 1229, { basmati: 0.6, "chicken-curry-cut": 1, onion: 0.2, ghee: 0.06, spices: 0.03, "dry-fruits": 0.02, oil: 0.04 }),
        ] },
    ],
  },
  {
    category: "Signature South Indian", station: STATION.indian, dishes: [
      { name: "Kerala Parotta (2 pcs) with Chicken Gravy", price: 199, veg: false, recipe: mix(scale(B.masala, 0.6), { parotta: 2, "chicken-curry-cut": 0.15 }) },
      { name: "Tomato Rasam with Steamed Rice", price: 229, veg: true, recipe: { rice: 0.12, tomato: 0.12, "toor-dal": 0.02, spices: 0.005, garlic: 0.005, oil: 0.01, coriander: 0.002 } },
      { name: "Chicken Rasam with Steamed Rice", price: 259, veg: false, recipe: { rice: 0.12, tomato: 0.1, "chicken-curry-cut": 0.1, spices: 0.006, garlic: 0.006, oil: 0.01, coriander: 0.002 } },
      { name: "XTSY Spl. Curd Rice with Chicken 65", price: 269, veg: false, recipe: mix(scale(B.batter, 0.5), { rice: 0.12, curd: 0.15, milk: 0.05, "chicken-boneless": 0.1, spices: 0.004 }) },
      { name: "XTSY Spl. Chicken Ghee Roast", price: 329, veg: false, recipe: { "chicken-curry-cut": 0.25, ghee: 0.04, spices: 0.015, curd: 0.03, onion: 0.05, "ginger-garlic": 0.01 } },
    ],
  },
  {
    category: "Chinese Fried Rice & Noodles", station: STATION.chinese, dishes: [
      { name: "Burned Garlic Hakka Noodles", price: 259, veg: false, recipe: mix(B.noodles, { garlic: 0.01 }), variants: proteinPortions("bg-noodles", [259, 299, 349]), addons: ADDONS.eggSeafood },
      { name: "Hot Schezwan Hakka Noodles", price: 259, veg: false, recipe: mix(B.noodles, { schezwan: 0.04 }), variants: proteinPortions("sz-noodles", [259, 299, 349]), addons: ADDONS.eggSeafood },
      { name: "Burned Garlic Fried Rice", price: 249, veg: false, popular: true, recipe: mix(B.friedRice, { garlic: 0.01 }), variants: proteinPortions("bg-rice", [249, 289, 339]), addons: ADDONS.eggSeafood },
      { name: "Hot Schezwan Fried Rice", price: 249, veg: false, recipe: mix(B.friedRice, { schezwan: 0.04 }), variants: proteinPortions("sz-rice", [249, 289, 339]), addons: ADDONS.eggSeafood },
    ],
  },
  {
    category: "Chinese Gravy - Veg", station: STATION.chinese, dishes: [
      { name: "Veg Manchurian Gravy", price: 279, veg: true, recipe: mix(B.indoChinese, B.gravy, { cabbage: 0.08, carrot: 0.04, beans: 0.02, maida: 0.02, cornflour: 0.02, oil: 0.04 }) },
      { name: "Veg Schezwan Gravy", price: 279, veg: true, recipe: mix(B.schezwan, B.gravy, B.vegMix) },
      { name: "Paneer Chilli Gravy", price: 299, veg: true, recipe: mix(B.batter, B.indoChinese, B.gravy, { paneer: 0.18 }) },
      { name: "Paneer Manchurian Gravy", price: 329, veg: true, recipe: mix(B.batter, B.indoChinese, B.gravy, { paneer: 0.18, garlic: 0.005 }) },
      { name: "Mushroom Chilli Gravy", price: 329, veg: true, recipe: mix(B.batter, B.indoChinese, B.gravy, { mushroom: 0.2 }) },
      { name: "Mushroom Manchurian Gravy", price: 349, veg: true, recipe: mix(B.batter, B.indoChinese, B.gravy, { mushroom: 0.2, garlic: 0.005 }) },
    ],
  },
  {
    category: "Chinese Gravy - Non Veg", station: STATION.chinese, dishes: [
      { name: "Chilli Chicken Gravy", price: 329, veg: false, recipe: mix(B.batter, B.indoChinese, B.gravy, { "chicken-boneless": 0.22 }) },
      { name: "Chicken Schezwan Gravy", price: 329, veg: false, recipe: mix(B.batter, B.schezwan, B.gravy, { "chicken-boneless": 0.22 }) },
      { name: "Chicken Manchurian Gravy", price: 349, veg: false, recipe: mix(B.batter, B.indoChinese, B.gravy, { "chicken-boneless": 0.22, garlic: 0.005 }) },
      { name: "Chicken Cheese Manchurian Gravy", price: 369, veg: false, recipe: mix(B.batter, B.indoChinese, B.gravy, { "chicken-boneless": 0.22, cheese: 0.03 }) },
      { name: "Honey Chilli Chicken Gravy", price: 389, veg: false, recipe: mix(B.batter, B.indoChinese, B.gravy, { "chicken-boneless": 0.22, honey: 0.03 }) },
      { name: "Chef's Special Chicken Gravy", price: 389, veg: false, recipe: mix(B.batter, B.indoChinese, B.gravy, { "chicken-boneless": 0.22, cashew: 0.01, honey: 0.01 }) },
    ],
  },
  {
    category: "XTSY Hand Crafted Pastas", station: STATION.conti, dishes: [
      { name: "Alfredo White Pasta", price: 329, veg: false, recipe: { pasta: 0.1, butter: 0.015, maida: 0.01, milk: 0.12, cream: 0.04, cheese: 0.025, garlic: 0.005 },
        variants: proteinPortions("alfredo", [329, 349, 389], { veg: { mushroom: 0.04, broccoli: 0.03, capsicum: 0.02 }, chicken: { "chicken-boneless": 0.08 }, seafood: { "seafood-mix": 0.08 } }), addons: ADDONS.seafood },
      { name: "Arrabbiata Red Pasta", price: 329, veg: false, recipe: { pasta: 0.1, tomato: 0.15, garlic: 0.008, oil: 0.015, "chilli-sauce": 0.005, cheese: 0.01 },
        variants: proteinPortions("arrabbiata", [329, 349, 389], { veg: { mushroom: 0.04, broccoli: 0.03, capsicum: 0.02 }, chicken: { "chicken-boneless": 0.08 }, seafood: { "seafood-mix": 0.08 } }), addons: ADDONS.seafood },
    ],
  },
  {
    category: "Chopsuey's with Love", station: STATION.chinese, dishes: [
      { name: "American Chopsuey", price: 289, veg: false, recipe: mix(B.vegMix, { noodles: 0.08, oil: 0.05, ketchup: 0.04, sugar: 0.01, vinegar: 0.005, cornflour: 0.015 }),
        variants: proteinPortions("american-chopsuey", [289, 329, 379], { veg: { mushroom: 0.03 }, chicken: { "chicken-boneless": 0.08 }, seafood: { "seafood-mix": 0.08 } }), addons: ADDONS.eggSeafood },
      { name: "Chinese Garlic Chopsuey", price: 299, veg: false, recipe: mix(B.vegMix, { noodles: 0.08, oil: 0.05, garlic: 0.015, "soy-sauce": 0.012, cornflour: 0.015 }),
        variants: proteinPortions("garlic-chopsuey", [299, 349, 399], { veg: { mushroom: 0.03 }, chicken: { "chicken-boneless": 0.08 }, seafood: { "seafood-mix": 0.08 } }), addons: ADDONS.eggSeafood },
    ],
  },
  {
    category: "Snack Corner", station: STATION.conti, dishes: [
      { name: "French Fries", price: 149, veg: true, recipe: { fries: 0.2, oil: 0.03, ketchup: 0.02 }, addons: ADDONS.snack },
      { name: "Peri Peri Fries", price: 179, veg: true, recipe: { fries: 0.2, oil: 0.03, ketchup: 0.02, "peri-peri": 0.006 }, addons: ADDONS.snack },
      { name: "Papad Masala", price: 159, veg: true, recipe: { papad: 2, onion: 0.04, tomato: 0.04, coriander: 0.003, spices: 0.002, lemon: 0.25, oil: 0.02 }, addons: ADDONS.snack },
      { name: "Peanut Masala", price: 169, veg: true, recipe: { peanuts: 0.12, onion: 0.04, tomato: 0.03, "green-chilli": 0.003, lemon: 0.25, spices: 0.002, coriander: 0.002 }, addons: ADDONS.snack },
    ],
  },
  {
    category: "Desserts", station: STATION.dessert, dishes: [
      { name: "Choice of Ice Cream", price: 149, veg: true, recipe: { "ice-cream": 0.15 }, addons: ADDONS.dessert,
        variants: [opt("ic-chocolate", "Chocolate", 149), opt("ic-vanilla", "Vanilla", 149), opt("ic-strawberry", "Strawberry", 149)] },
      { name: "Fruit Bowl", price: 159, veg: true, recipe: { fruits: 0.3 }, addons: ADDONS.dessert },
      { name: "Fruit Bowl with Cream", price: 189, veg: true, recipe: { fruits: 0.25, cream: 0.05, sugar: 0.01 }, addons: ADDONS.dessert },
      { name: "Fruit Salad", price: 189, veg: true, recipe: { fruits: 0.2, milk: 0.1, sugar: 0.02, cornflour: 0.01 }, addons: ADDONS.dessert },
      { name: "Hot Brownie", price: 229, veg: false, recipe: { brownie: 1, "choco-syrup": 0.02 }, addons: ADDONS.dessert },
      { name: "Hot Brownie with Ice Cream", price: 259, veg: false, popular: true, recipe: { brownie: 1, "choco-syrup": 0.02, "ice-cream": 0.08 }, addons: ADDONS.dessert },
      { name: "XTSY Spl. Classic Kunafa", price: 349, veg: true, popular: true, recipe: { kataifi: 0.12, cheese: 0.08, butter: 0.03, sugar: 0.04, pistachio: 0.01 }, addons: ADDONS.dessert },
      { name: "XTSY Spl. Classic Cream Kunafa", price: 389, veg: true, recipe: { kataifi: 0.12, cheese: 0.06, cream: 0.06, butter: 0.03, sugar: 0.04, pistachio: 0.01 }, addons: ADDONS.dessert },
    ],
  },
];

export const TAB_CATEGORIES = SECTIONS.map((s) => s.category);

export const TAB_MENU: MenuItem[] = SECTIONS.flatMap((section) =>
  section.dishes.map((dish): MenuItem => {
    const id = `tab-${slug(dish.name)}`;
    const recipe = toRecipe(dish.recipe ?? {});
    const vegVariants = dish.variants?.filter((v) => v.veg !== undefined) ?? [];
    return {
      id,
      name: dish.name,
      category: section.category,
      price: dish.variants?.[0]?.price ?? dish.price,
      // A dish with veg and non-veg portions shows its first portion's mark.
      veg: vegVariants.length ? Boolean(vegVariants[0]?.veg) : dish.veg,
      gstRate: 5,
      station: section.station,
      available: true,
      ...(dish.popular ? { popular: true } : {}),
      ...(dish.variants ? { variants: dish.variants.map((v) => ({ ...v, id: `${id}--${v.id}` })) } : {}),
      ...(dish.addons ? { addons: dish.addons.map((a) => ({ ...a, id: `${id}--${a.id}` })) } : {}),
      ...(recipe.length ? { recipe } : {}),
      ...(dish.description ? { description: dish.description } : {}),
      ...(section.hours ? { hours: section.hours } : {}),
    };
  }),
);
