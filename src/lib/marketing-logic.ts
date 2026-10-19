/**
 * Branding for the guest ordering page and WhatsApp marketing: pure logic,
 * no database or network, so every rule here is tested.
 */
import type { Customer, Order } from "./types";

/* ------------------------------------------------------------------ branding */

export interface Offer {
  id: string;
  title: string;
  detail?: string;
  /** Last day the offer shows, YYYY-MM-DD (India date). Empty = until removed. */
  until?: string;
  /** A dish the offer points to; tapping the banner jumps to it. */
  itemId?: string;
}

export interface BrandLinks {
  instagram?: string;
  googleReview?: string;
  website?: string;
  stays?: string;
  voyage?: string;
}

export interface Branding {
  /** Small compressed images (data URLs) so the page works without file storage. */
  logo?: string;
  cover?: string;
  /** Brand colour, #rrggbb. */
  color?: string;
  tagline?: string;
  /** Shown above the menu, e.g. "Welcome! Wi-Fi: TAB-Guest". */
  welcome?: string;
  offers?: Offer[];
  links?: BrandLinks;
  /** The restaurant's WhatsApp number guests can message, digits. */
  whatsapp?: string;
  /** Ask guests at checkout whether they want offers on WhatsApp. */
  askOptIn?: boolean;
}

export const LINK_LABELS: Record<keyof BrandLinks, string> = {
  instagram: "Instagram",
  googleReview: "Google review",
  website: "Website",
  stays: "Stay with us",
  voyage: "Travel with us",
};

const HEX = /^#[0-9a-f]{6}$/i;
const IMAGE = /^data:image\/(webp|jpeg|png);base64,[a-z0-9+/=]+$/i;
export const MAX_IMAGE_CHARS = 260_000; // ~190 KB each; the database caps branding at 700 KB in total

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim().slice(0, max);
  return text || undefined;
}

/** Only https links (or instagram handles) make it onto the public page. */
export function cleanUrl(value: unknown, kind?: keyof BrandLinks): string | undefined {
  const text = cleanText(value, 300);
  if (!text) return undefined;
  if (kind === "instagram" && /^@?[a-z0-9._]{1,30}$/i.test(text)) return `https://instagram.com/${text.replace(/^@/, "")}`;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (!url.hostname.includes(".")) return undefined;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Tidy whatever the settings form holds into what's safe to publish. */
export function sanitizeBranding(input: Branding): Branding {
  const out: Branding = {};
  if (typeof input.logo === "string" && IMAGE.test(input.logo) && input.logo.length <= MAX_IMAGE_CHARS) out.logo = input.logo;
  if (typeof input.cover === "string" && IMAGE.test(input.cover) && input.cover.length <= MAX_IMAGE_CHARS) out.cover = input.cover;
  if (typeof input.color === "string" && HEX.test(input.color)) out.color = input.color.toLowerCase();
  const tagline = cleanText(input.tagline, 90);
  if (tagline) out.tagline = tagline;
  const welcome = cleanText(input.welcome, 160);
  if (welcome) out.welcome = welcome;
  const offers = (input.offers ?? []).flatMap((o): Offer[] => {
    const title = cleanText(o.title, 60);
    if (!title) return [];
    const offer: Offer = { id: cleanText(o.id, 40) ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title };
    const detail = cleanText(o.detail, 120);
    if (detail) offer.detail = detail;
    if (o.until && /^\d{4}-\d{2}-\d{2}$/.test(o.until)) offer.until = o.until;
    const itemId = cleanText(o.itemId, 80);
    if (itemId) offer.itemId = itemId;
    return [offer];
  }).slice(0, 5);
  if (offers.length) out.offers = offers;
  const links: BrandLinks = {};
  for (const key of Object.keys(LINK_LABELS) as (keyof BrandLinks)[]) {
    const url = cleanUrl(input.links?.[key], key);
    if (url) links[key] = url;
  }
  if (Object.keys(links).length) out.links = links;
  const wa = waNumber(input.whatsapp);
  if (wa) out.whatsapp = wa;
  if (input.askOptIn !== false) out.askOptIn = true;
  return out;
}

/** India date for "today", YYYY-MM-DD. */
export function indiaDay(now: number): string {
  return new Date(now + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function activeOffers(offers: Offer[] | undefined, now: number): Offer[] {
  const today = indiaDay(now);
  return (offers ?? []).filter((o) => !o.until || o.until >= today);
}

/* ---------------------------------------------------------- brand colours */

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
function mix(hex: string, other: string, amount: number): string {
  const a = rgb(hex);
  const b = rgb(other);
  return `#${a.map((v, i) => Math.round(v + ((b[i] ?? 0) - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}

const WHITE = "#ffffff";
const INK = "#111111";

/**
 * Turn one brand colour into the page's colour tokens, keeping text readable:
 * very light colours are darkened until white text passes 4.5:1, so buttons
 * never become unreadable whatever colour the owner picks.
 */
export function brandPalette(color: string | undefined): Record<string, string> | null {
  if (!color || !HEX.test(color)) return null;
  let primary = color.toLowerCase();
  for (let i = 0; i < 12 && contrastRatio(primary, WHITE) < 4.5; i += 1) primary = mix(primary, INK, 0.12);
  return {
    "--primary": primary,
    "--primary-foreground": WHITE,
    "--primary-hover": mix(primary, INK, 0.15),
    "--primary-tint": mix(primary, WHITE, 0.9),
    "--ring": primary,
  };
}

/* ------------------------------------------------------------- WhatsApp */

/** WhatsApp wants the full number with country code; Indian 10-digit numbers get 91. */
export function waNumber(raw: string | undefined | null): string | null {
  const digits = (raw ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/** Opens WhatsApp (app or web) with the message ready to send. */
export function waLink(phone: string | null | undefined, text: string): string {
  const number = waNumber(phone);
  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  return number ? `https://wa.me/${number}${query}` : `https://wa.me/${query}`;
}

export interface TemplateVars { name?: string; restaurant?: string; link?: string; offer?: string }

/** Fill {name}, {first}, {restaurant}, {link} and {offer}; unknown names stay as written. */
export function fillTemplate(text: string, vars: TemplateVars): string {
  const first = (vars.name ?? "").trim().split(/\s+/)[0] ?? "";
  const values: Record<string, string> = {
    name: vars.name?.trim() || "there",
    first: first || "there",
    restaurant: vars.restaurant ?? "",
    link: vars.link ?? "",
    offer: vars.offer ?? "",
  };
  return text.replace(/\{(name|first|restaurant|link|offer)\}/g, (_, key: string) => values[key] ?? "")
    .replace(/[ \t]+\n/g, "\n").trim();
}

export const STARTER_MESSAGES: { id: string; label: string; text: string }[] = [
  { id: "offer", label: "Today's offer", text: "Hi {first}! {offer} today at {restaurant}. Order ahead: {link}" },
  { id: "new", label: "New on the menu", text: "Hi {first}, something new just landed on the {restaurant} menu. Come try it, or order for pickup: {link}" },
  { id: "miss", label: "We miss you", text: "Hi {first}, it's been a while! Your table at {restaurant} is waiting. See the menu: {link}" },
  { id: "thanks", label: "Thank you", text: "Thank you for dining at {restaurant}, {first}! We'd love a quick review, and hope to see you again soon." },
  { id: "festival", label: "Festival greetings", text: "Warm wishes from all of us at {restaurant}, {first}! Celebrate with us: {link}" },
];

/** Reply STOP lines keep campaigns honest and within WhatsApp's rules. */
export const OPT_OUT_LINE = "Reply STOP to stop offers.";

export function withOptOut(text: string): string {
  return /reply stop/i.test(text) ? text : `${text}\n\n${OPT_OUT_LINE}`;
}

/* --------------------------------------------------------------- audience */

export interface GuestProfile {
  id: string;
  phone: string;
  name: string;
  optIn: boolean;
  visits: number;
  spend: number;
  firstVisit: number | null;
  lastVisit: number | null;
  lastMessagedAt: number | null;
  ordersOnline: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** One line per guest: consent, visits and spend from their settled bills. */
export function buildAudience(customers: Customer[], orders: Pick<Order, "customerId" | "status" | "total" | "createdAt" | "source">[]): GuestProfile[] {
  const byCustomer = new Map<string, { visits: number; spend: number; first: number; last: number; online: number }>();
  for (const o of orders) {
    if (!o.customerId || o.status !== "settled") continue;
    const s = byCustomer.get(o.customerId) ?? { visits: 0, spend: 0, first: o.createdAt, last: o.createdAt, online: 0 };
    s.visits += 1;
    s.spend += o.total;
    s.first = Math.min(s.first, o.createdAt);
    s.last = Math.max(s.last, o.createdAt);
    if (o.source) s.online += 1;
    byCustomer.set(o.customerId, s);
  }
  return customers.map((c) => {
    const s = byCustomer.get(c.id);
    return {
      id: c.id,
      phone: c.phone,
      name: c.name ?? "",
      optIn: !!c.whatsapp?.optIn,
      visits: s?.visits ?? 0,
      spend: s?.spend ?? 0,
      firstVisit: s?.first ?? null,
      lastVisit: s?.last ?? null,
      lastMessagedAt: c.whatsapp?.lastMessagedAt ?? null,
      ordersOnline: s?.online ?? 0,
    };
  });
}

export type SegmentId = "all" | "recent" | "lapsed" | "regulars" | "top" | "new" | "ordered-online";

export const SEGMENTS: { id: SegmentId; label: string; hint: string }[] = [
  { id: "all", label: "Everyone who said yes", hint: "All guests who agreed to WhatsApp offers" },
  { id: "recent", label: "Visited in the last 30 days", hint: "Good for a new dish or a weekend offer" },
  { id: "lapsed", label: "Haven't come in 45+ days", hint: "A 'we miss you' nudge" },
  { id: "regulars", label: "Regulars (4+ visits)", hint: "Thank them, or give first look at something new" },
  { id: "top", label: "Top spenders (top 20%)", hint: "Your most valuable guests" },
  { id: "new", label: "First visit in the last 14 days", hint: "Turn a first visit into a second" },
  { id: "ordered-online", label: "Ordered by QR or online", hint: "Guests already using the ordering page" },
];

export function inSegment(guest: GuestProfile, segment: SegmentId, now: number, topSpendFloor: number): boolean {
  switch (segment) {
    case "all": return true;
    case "recent": return guest.lastVisit !== null && now - guest.lastVisit <= 30 * DAY;
    case "lapsed": return guest.lastVisit !== null && now - guest.lastVisit >= 45 * DAY;
    case "regulars": return guest.visits >= 4;
    case "top": return guest.spend > 0 && guest.spend >= topSpendFloor;
    case "new": return guest.firstVisit !== null && now - guest.firstVisit <= 14 * DAY;
    case "ordered-online": return guest.ordersOnline > 0;
  }
}

/** Spend that puts a guest in the top 20% of guests who have spent anything. */
export function topSpendFloor(guests: GuestProfile[]): number {
  const spends = guests.map((g) => g.spend).filter((s) => s > 0).sort((a, b) => b - a);
  if (!spends.length) return Number.POSITIVE_INFINITY;
  return spends[Math.max(0, Math.ceil(spends.length * 0.2) - 1)] ?? Number.POSITIVE_INFINITY;
}

export type SkipReason = "no consent" | "messaged recently" | "no valid number";
export interface Recipient { id: string; phone: string; wa: string; name: string }

/**
 * Who a campaign goes to. Only guests who said yes, never twice within the
 * cool-down, and only numbers WhatsApp can reach.
 */
export function pickRecipients(guests: GuestProfile[], segment: SegmentId, now: number, cooldownDays = 3): { ready: Recipient[]; skipped: { guest: GuestProfile; reason: SkipReason }[] } {
  const floor = topSpendFloor(guests);
  const ready: Recipient[] = [];
  const skipped: { guest: GuestProfile; reason: SkipReason }[] = [];
  for (const g of guests) {
    if (!inSegment(g, segment, now, floor)) continue;
    if (!g.optIn) { skipped.push({ guest: g, reason: "no consent" }); continue; }
    const wa = waNumber(g.phone);
    if (!wa) { skipped.push({ guest: g, reason: "no valid number" }); continue; }
    if (g.lastMessagedAt !== null && now - g.lastMessagedAt < cooldownDays * DAY) { skipped.push({ guest: g, reason: "messaged recently" }); continue; }
    ready.push({ id: g.id, phone: g.phone, wa, name: g.name });
  }
  ready.sort((a, b) => a.name.localeCompare(b.name) || a.wa.localeCompare(b.wa));
  return { ready, skipped };
}

/* ---------------------------------------------------------------- exports */

const csvCell = (v: string | number) => {
  const text = String(v);
  // Stop spreadsheet apps treating a cell as a formula.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function audienceCsv(recipients: Recipient[]): string {
  return ["Name,WhatsApp", ...recipients.map((r) => `${csvCell(r.name)},+${r.wa}`)].join("\n");
}

/** Contacts file: save these to the phone, then add them to a WhatsApp Business broadcast list. */
export function audienceVcard(recipients: Recipient[], tag: string): string {
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, " ");
  return recipients.map((r) => [
    "BEGIN:VCARD", "VERSION:3.0",
    `FN:${esc(r.name || `Guest ${r.wa.slice(-4)}`)}${tag ? ` (${esc(tag)})` : ""}`,
    `TEL;TYPE=CELL:+${r.wa}`,
    "END:VCARD",
  ].join("\r\n")).join("\r\n");
}

/* ------------------------------------------------------------ QR sources */

export interface ScanRow { day: string; source: string; scans: number }

/** QR codes carry a short source label so the owner can see which ones work. */
export function sourceLabel(source: string, tables: { id: string; label: string }[]): string {
  const fixed: Record<string, string> = { direct: "Direct link", poster: "Poster", counter: "Counter stand", insta: "Instagram", google: "Google", whatsapp: "WhatsApp", flyer: "Flyer", menu: "Menu card" };
  if (fixed[source]) return fixed[source] ?? source;
  const table = tables.find((t) => t.id.toLowerCase() === source);
  return table ? `Table ${table.label}` : source;
}

export function scanSummary(rows: ScanRow[], ordersBySource: Map<string, number>): { source: string; scans: number; orders: number; rate: number }[] {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.source, (totals.get(r.source) ?? 0) + r.scans);
  return [...totals].map(([source, scans]) => {
    const orders = ordersBySource.get(source) ?? 0;
    return { source, scans, orders, rate: scans ? Math.min(1, orders / scans) : 0 };
  }).sort((a, b) => b.scans - a.scans || a.source.localeCompare(b.source));
}

/** A scan source safe to put in a link: lower-case letters, numbers and dashes. */
export function cleanSource(source: string): string {
  return source.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24);
}

/** Quick brand colour choices; any colour works (see brandPalette). */
export const BRAND_SWATCHES: { name: string; hex: string }[] = [
  { name: "Pine", hex: "#0f5132" },
  { name: "Teal", hex: "#0f766e" },
  { name: "Ocean", hex: "#0057b8" },
  { name: "Plum", hex: "#6b2d5c" },
  { name: "Chilli", hex: "#b42318" },
  { name: "Saffron", hex: "#c2410c" },
  { name: "Coffee", hex: "#6f4e37" },
  { name: "Graphite", hex: "#1d1d1f" },
];

/** Where a QR code or link will be used; becomes its scan source. */
export const SCAN_SOURCES: { id: string; label: string }[] = [
  { id: "poster", label: "Poster" },
  { id: "counter", label: "Counter stand" },
  { id: "menu", label: "Menu card" },
  { id: "flyer", label: "Flyer" },
  { id: "insta", label: "Instagram" },
  { id: "google", label: "Google" },
  { id: "whatsapp", label: "WhatsApp" },
];
