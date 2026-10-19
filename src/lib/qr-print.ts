/**
 * Printable, branded QR material: table tents, stickers, a poster and a
 * counter standee. Builds a self-contained HTML page that prints on A4.
 * Pure except for QR image generation, so the layout rules are tested.
 */
import { brandPalette, contrastRatio, type Branding } from "./marketing-logic";

export type PrintDesign = "tent" | "sticker" | "poster" | "standee";

export const PRINT_DESIGNS: { id: PrintDesign; label: string; hint: string; perSheet: number; perTable: boolean }[] = [
  { id: "tent", label: "Table tent", hint: "Folds in half to stand on the table; reads from both sides. 2 per A4.", perSheet: 2, perTable: true },
  { id: "sticker", label: "Table sticker", hint: "Square, for the table top or wall. 6 per A4.", perSheet: 6, perTable: true },
  { id: "poster", label: "Poster", hint: "One A4 for the entrance, window or wall.", perSheet: 1, perTable: false },
  { id: "standee", label: "Counter standee", hint: "A5 for the counter or reception: order for pickup. 2 per A4.", perSheet: 2, perTable: false },
];

export interface PrintCard {
  /** "Table 4", or empty for posters and standees. */
  label: string;
  url: string;
  /** QR image (data URL) for url. */
  qr: string;
}

export interface PrintOptions {
  restaurant: string;
  brand: Branding;
  headline: string;
  /** Short line under the QR, e.g. "Scan · Order · Relax". */
  subline: string;
  /** A current offer to feature on posters and standees. */
  offer?: string;
}

/* Print colours. The brand colour is used when it's dark enough to scan reliably. */
const INK = "#111111";
const PAPER = "#ffffff";
const MUTED = "#5f6368";
const DEFAULT_BRAND = "#1d1d1f";
/** Background of QR codes (opaque white, scanned best). */
export const QR_LIGHT = "#ffffffff";

/** Colour for the QR's dark squares: brand colour only with strong contrast on white. */
export function qrInk(brand: Branding): string {
  const primary = brandPalette(brand.color)?.["--primary"];
  return primary && contrastRatio(primary, PAPER) >= 7 ? primary : INK;
}

export function accentFor(brand: Branding): string {
  return brandPalette(brand.color)?.["--primary"] ?? DEFAULT_BRAND;
}

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Only our own sanitised data-URL images go into the page. */
const safeImage = (src: string | undefined) => (src && /^data:image\/(webp|jpeg|png);base64,[a-z0-9+/=]+$/i.test(src) ? src : "");

function handleFrom(url: string | undefined): string {
  if (!url) return "";
  const m = /instagram\.com\/([^/?#]+)/i.exec(url);
  return m ? `@${m[1]}` : "";
}

function footer(o: PrintOptions): string {
  const bits = [handleFrom(o.brand.links?.instagram), o.brand.whatsapp ? `WhatsApp +${o.brand.whatsapp}` : ""].filter(Boolean);
  return bits.length ? `<div class="foot">${bits.map(escapeHtml).join("<span class=\"dot\">·</span>")}</div>` : "";
}

function qrBlock(card: PrintCard, logo: string, size: string): string {
  return `<div class="qr" style="width:${size};height:${size}"><img class="code" src="${card.qr}" alt="" />${logo ? `<span class="badge"><img src="${logo}" alt="" /></span>` : ""}</div>`;
}

function face(card: PrintCard, o: PrintOptions, logo: string, qrSize: string): string {
  return `
    <div class="brandbar">${logo ? `<img class="logo" src="${logo}" alt="" />` : ""}<div><div class="name">${escapeHtml(o.restaurant)}</div>${o.brand.tagline ? `<div class="tag">${escapeHtml(o.brand.tagline)}</div>` : ""}</div></div>
    <div class="body">
      <div class="headline">${escapeHtml(o.headline)}</div>
      ${qrBlock(card, logo, qrSize)}
      ${card.label ? `<div class="label">${escapeHtml(card.label)}</div>` : ""}
      <div class="sub">${escapeHtml(o.subline)}</div>
    </div>
    ${footer(o)}`;
}

/** The whole printable page. */
export function buildPrintSheet(design: PrintDesign, cards: PrintCard[], o: PrintOptions): string {
  const accent = accentFor(o.brand);
  const logo = safeImage(o.brand.logo);
  const cover = safeImage(o.brand.cover);
  let pages = "";
  if (design === "tent") {
    // Each tent: two A6 panels on an A5 strip; the top one is upside down so both sides read correctly once folded.
    pages = cards.map((c) => `<div class="tent"><div class="panel flip">${face(c, o, logo, "54mm")}</div><div class="fold"></div><div class="panel">${face(c, o, logo, "54mm")}</div></div>`).join("");
  } else if (design === "sticker") {
    pages = `<div class="stickers">${cards.map((c) => `<div class="sticker">${face(c, o, logo, "44mm")}</div>`).join("")}</div>`;
  } else if (design === "poster") {
    pages = cards.map((c) => `
      <div class="poster">
        ${cover ? `<div class="cover"><img src="${cover}" alt="" /></div>` : `<div class="cover plain"></div>`}
        <div class="pbody">
          ${logo ? `<img class="plogo" src="${logo}" alt="" />` : ""}
          <div class="pname">${escapeHtml(o.restaurant)}</div>
          ${o.brand.tagline ? `<div class="tag">${escapeHtml(o.brand.tagline)}</div>` : ""}
          <div class="headline big">${escapeHtml(o.headline)}</div>
          ${o.offer ? `<div class="offer">${escapeHtml(o.offer)}</div>` : ""}
          ${qrBlock(c, logo, "96mm")}
          <ol class="steps"><li><b>1</b>Scan</li><li><b>2</b>Choose</li><li><b>3</b>Enjoy</li></ol>
          <div class="sub">${escapeHtml(o.subline)}</div>
          ${footer(o)}
        </div>
      </div>`).join("");
  } else {
    pages = `<div class="standees">${cards.map((c) => `<div class="standee">${face(c, o, logo, "62mm")}${o.offer ? `<div class="offer small">${escapeHtml(o.offer)}</div>` : ""}</div>`).join("")}</div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(o.restaurant)} QR codes</title><style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Figtree, "Helvetica Neue", Arial, sans-serif; color: ${INK}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .brandbar { display: flex; align-items: center; gap: 3mm; background: ${accent}; color: ${PAPER}; padding: 4mm 5mm; }
  .logo { width: 12mm; height: 12mm; border-radius: 2.5mm; background: ${PAPER}; object-fit: contain; padding: 0.6mm; }
  .name { font-weight: 800; font-size: 13pt; line-height: 1.1; }
  .tag { font-size: 8.5pt; opacity: .9; margin-top: .6mm; }
  .body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3mm 5mm; text-align: center; }
  .headline { font-weight: 800; font-size: 17pt; letter-spacing: -.01em; margin-bottom: 3mm; }
  .headline.big { font-size: 30pt; margin: 4mm 0 3mm; line-height: 1.05; }
  .qr { position: relative; padding: 2.5mm; border-radius: 4mm; background: ${PAPER}; box-shadow: 0 0 0 .5mm ${accent}; }
  .qr .code { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
  .qr .badge { position: absolute; left: 50%; top: 50%; width: 21%; height: 21%; transform: translate(-50%, -50%); background: ${PAPER}; border-radius: 2mm; padding: 1.2%; display: flex; }
  .qr .badge img { width: 100%; height: 100%; object-fit: contain; }
  .label { font-weight: 900; font-size: 26pt; margin-top: 3mm; color: ${accent}; }
  .sub { font-size: 9.5pt; color: ${MUTED}; margin-top: 2mm; }
  .foot { font-size: 8.5pt; color: ${MUTED}; padding: 2.5mm 4mm 4mm; text-align: center; }
  .dot { margin: 0 2mm; }
  .offer { display: inline-block; background: ${accent}; color: ${PAPER}; font-weight: 800; font-size: 14pt; border-radius: 99mm; padding: 2mm 6mm; margin-bottom: 4mm; }
  .offer.small { font-size: 10pt; margin: 0 auto 4mm; }
  .tent { width: 210mm; height: 148.5mm; display: flex; flex-direction: column; break-after: page; }
  .tent:nth-child(2n) { break-after: page; }
  .panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .panel.flip { transform: rotate(180deg); }
  .fold { height: 0; border-top: .3mm dashed ${MUTED}; }
  .stickers { display: grid; grid-template-columns: repeat(2, 86mm); grid-auto-rows: 86mm; gap: 8mm; justify-content: center; padding: 12mm 0; }
  .sticker { border-radius: 6mm; overflow: hidden; display: flex; flex-direction: column; border: .4mm solid ${accent}; break-inside: avoid; }
  .sticker .brandbar { padding: 2.5mm 4mm; } .sticker .logo { width: 9mm; height: 9mm; } .sticker .name { font-size: 10.5pt; }
  .sticker .headline { font-size: 12pt; margin-bottom: 1.5mm; } .sticker .label { font-size: 15pt; margin-top: 1.5mm; } .sticker .sub, .sticker .foot { display: none; }
  .poster { width: 210mm; height: 297mm; display: flex; flex-direction: column; break-after: page; }
  .cover { height: 62mm; overflow: hidden; background: ${accent}; } .cover img { width: 100%; height: 100%; object-fit: cover; }
  .pbody { flex: 1; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 0 14mm; }
  .plogo { width: 30mm; height: 30mm; border-radius: 6mm; background: ${PAPER}; object-fit: contain; padding: 1.5mm; margin-top: -15mm; box-shadow: 0 1mm 4mm rgba(0,0,0,.18); }
  .pname { font-weight: 900; font-size: 24pt; margin-top: 3mm; }
  .poster .tag { color: ${MUTED}; font-size: 11pt; }
  .steps { list-style: none; display: flex; gap: 10mm; padding: 0; margin: 6mm 0 1mm; font-weight: 700; font-size: 12pt; }
  .steps b { display: inline-flex; align-items: center; justify-content: center; width: 7mm; height: 7mm; border-radius: 99mm; background: ${accent}; color: ${PAPER}; margin-right: 2mm; font-size: 10pt; }
  .standees { display: flex; flex-direction: column; }
  .standee { width: 210mm; height: 148.5mm; display: flex; flex-direction: column; border-bottom: .3mm dashed ${MUTED}; break-inside: avoid; }
  .standee:nth-child(2n) { border-bottom: 0; break-after: page; }
  @media screen { body { background: #e8e8ed; } .tent, .poster, .standee, .stickers { background: ${PAPER}; margin: 6mm auto; box-shadow: 0 1mm 6mm rgba(0,0,0,.15); } .stickers { width: 210mm; } }
</style></head><body>${pages}<script>window.onload = () => setTimeout(() => window.print(), 300);</script></body></html>`;
}
