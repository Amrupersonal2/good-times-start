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
  /** Look of the print: "xtsy" (pines and night sky, xtsy.one palette) or "classic" (brand colour bar). */
  theme?: PrintTheme;
}

export type PrintTheme = "xtsy" | "classic";
export const PRINT_THEMES: { id: PrintTheme; label: string; hint: string }[] = [
  { id: "xtsy", label: "XTSY Pines", hint: "Night sky, pines and stars on warm sand, in the xtsy.one colours and type." },
  { id: "classic", label: "Classic", hint: "Clean white card with your brand colour bar." },
];

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
  if (o.theme === "xtsy") return buildXtsySheet(design, cards, o);
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

/* ---------------- XTSY Pines theme (xtsy.one: sand, ink, night, pine, crimson; Staatliches + Manrope) ---------------- */

export const XT = { sand: "#F6F1EA", cream: "#EFE6DA", line: "#E3D8C9", ink: "#1F2230", night: "#1F2438", slate: "#2E3548", pine: "#2F4A3F", crimson: "#A12444", mute: "#4F566A", white: "#FFFFFF", stone: "#CFC3B2" } as const;

/** A ridge of pines, drawn as one SVG strip (deterministic so prints match the preview). */
function pines(fill: string, back: string): string {
  const tree = (x: number, h: number, w: number) => {
    const base = 60;
    // Three stacked tiers make a pine rather than a plain triangle.
    return [0, 1, 2].map((tier) => {
      const top = base - h + tier * h * 0.28;
      const half = w * (0.5 + tier * 0.22);
      return `${x},${top.toFixed(1)} ${(x + half).toFixed(1)},${(top + h * 0.42).toFixed(1)} ${(x - half).toFixed(1)},${(top + h * 0.42).toFixed(1)}`;
    }).map((pts) => `<polygon points="${pts}"/>`).join("") + `<rect x="${(x - 0.9).toFixed(1)}" y="${(base - 4).toFixed(1)}" width="1.8" height="4"/>`;
  };
  const backRow = [10, 34, 61, 92, 118, 147, 176, 204, 233, 262, 291, 318, 349, 378].map((x, i) => tree(x, 26 + ((i * 7) % 12), 9)).join("");
  const frontRow = [22, 48, 79, 105, 134, 162, 190, 219, 248, 276, 305, 334, 364, 392].map((x, i) => tree(x, 34 + ((i * 11) % 16), 11)).join("");
  return `<svg class="pines" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true"><g fill="${back}" opacity=".55">${backRow}</g><g fill="${fill}">${frontRow}</g><rect x="0" y="56" width="400" height="4" fill="${fill}"/></svg>`;
}

function stars(): string {
  const pts: [number, number, number][] = [[18, 14, 1.1], [52, 30, .7], [77, 9, .9], [109, 24, .6], [140, 12, 1.2], [171, 33, .7], [203, 8, .8], [236, 22, 1], [266, 11, .6], [298, 29, .9], [327, 15, 1.1], [361, 26, .7], [388, 10, .8], [124, 40, .5], [252, 42, .5], [44, 46, .6], [342, 44, .5]];
  return `<svg class="stars" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true">${pts.filter(([x]) => x > 250).map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${XT.sand}" opacity="${r > .9 ? .95 : .6}"/>`).join("")}<path d="M330 18 l1.4 3.2 3.2 1.4 -3.2 1.4 -1.4 3.2 -1.4 -3.2 -3.2 -1.4 3.2 -1.4z" fill="${XT.sand}"/></svg>`;
}

function xtSky(o: PrintOptions, logo: string, big = false): string {
  return `<div class="sky${big ? " big" : ""}">${stars()}
    <div class="brand">${logo ? `<img class="xlogo" src="${logo}" alt="" />` : ""}<div><div class="xname">${escapeHtml(o.restaurant)}</div>${o.brand.tagline ? `<div class="xtag">${escapeHtml(o.brand.tagline)}</div>` : ""}</div></div>
    ${pines(XT.sand, XT.pine)}</div>`;
}

function xtQr(card: PrintCard, logo: string, size: string): string {
  return `<div class="xqr" style="width:${size};height:${size}"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i><img class="code" src="${card.qr}" alt="" />${logo ? `<span class="badge"><img src="${logo}" alt="" /></span>` : ""}</div>`;
}

function xtFace(card: PrintCard, o: PrintOptions, logo: string, qrSize: string): string {
  return `${xtSky(o, logo)}
    <div class="xbody">
      ${o.subline ? `<div class="eyebrow">${escapeHtml(o.subline)}</div>` : ""}
      <div class="xhead">${escapeHtml(o.headline)}</div>
      ${xtQr(card, logo, qrSize)}
      ${card.label ? `<div class="xlabel">${escapeHtml(card.label)}</div>` : ""}
    </div>
    ${footer(o)}`;
}

/** Table tent panels are short (A6 landscape): text on the left, QR on the right. */
function xtTentFace(card: PrintCard, o: PrintOptions, logo: string): string {
  return `${xtSky(o, logo)}
    <div class="xbody row">
      <div class="xtext">
        ${o.subline ? `<div class="eyebrow">${escapeHtml(o.subline)}</div>` : ""}
        <div class="xhead">${escapeHtml(o.headline)}</div>
        ${card.label ? `<div class="xlabel">${escapeHtml(card.label)}</div>` : ""}
        ${footer(o)}
      </div>
      ${xtQr(card, logo, "44mm")}
    </div>`;
}

function buildXtsySheet(design: PrintDesign, cards: PrintCard[], o: PrintOptions): string {
  const logo = safeImage(o.brand.logo);
  let pages = "";
  if (design === "tent") {
    pages = cards.map((c) => `<div class="tent"><div class="panel xcard flip">${xtTentFace(c, o, logo)}</div><div class="fold"></div><div class="panel xcard">${xtTentFace(c, o, logo)}</div></div>`).join("");
  } else if (design === "sticker") {
    pages = `<div class="stickers">${cards.map((c) => `<div class="sticker xcard">${xtFace(c, o, logo, "40mm")}</div>`).join("")}</div>`;
  } else if (design === "poster") {
    pages = cards.map((c) => `
      <div class="poster xcard">
        ${xtSky(o, logo, true)}
        <div class="pbody">
          ${o.subline ? `<div class="eyebrow">${escapeHtml(o.subline)}</div>` : ""}
          <div class="xhead big">${escapeHtml(o.headline)}</div>
          ${o.offer ? `<div class="xoffer">${escapeHtml(o.offer)}</div>` : ""}
          ${xtQr(c, logo, "92mm")}
          <ol class="xsteps"><li><b>1</b>Scan</li><li><b>2</b>Choose</li><li><b>3</b>Enjoy</li></ol>
          ${footer(o)}
        </div>
      </div>`).join("");
  } else {
    pages = `<div class="standees">${cards.map((c) => `<div class="standee xcard">${xtFace(c, o, logo, "58mm")}${o.offer ? `<div class="xoffer small">${escapeHtml(o.offer)}</div>` : ""}</div>`).join("")}</div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(o.restaurant)} QR codes</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=Staatliches&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Manrope, "Helvetica Neue", Arial, sans-serif; color: ${XT.ink}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .xcard { background: ${XT.sand}; display: flex; flex-direction: column; overflow: hidden; }
  .sky { position: relative; background: radial-gradient(120% 90% at 80% 0%, ${XT.slate} 0%, ${XT.night} 55%, #151a2b 100%); color: ${XT.sand}; padding: 5mm 6mm 15mm; }
  .sky.big { padding: 12mm 14mm 30mm; }
  .stars { position: absolute; inset: 0 0 auto 0; width: 100%; height: 70%; }
  .pines { position: absolute; left: 0; right: 0; bottom: -1px; width: 100%; height: 13mm; }
  .sky.big .pines { height: 26mm; }
  .brand { position: relative; display: flex; align-items: center; gap: 3mm; }
  .xlogo { width: 12mm; height: 12mm; border-radius: 3mm; background: ${XT.white}; object-fit: contain; padding: .7mm; }
  .sky.big .xlogo { width: 22mm; height: 22mm; border-radius: 5mm; }
  .xname { font-family: Staatliches, Impact, sans-serif; font-size: 18pt; letter-spacing: .03em; line-height: 1; }
  .sky.big .xname { font-size: 34pt; }
  .xtag { font-size: 8.5pt; opacity: .85; margin-top: 1mm; }
  .sky.big .xtag { font-size: 12pt; }
  .xbody, .pbody { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2mm 6mm 1mm; }
  .eyebrow { font-family: Staatliches, Impact, sans-serif; color: ${XT.crimson}; letter-spacing: .22em; font-size: 10pt; }
  .xhead { font-family: Staatliches, Impact, sans-serif; font-size: 21pt; line-height: 1; letter-spacing: .01em; margin: 1mm 0 3mm; }
  .xhead.big { font-size: 42pt; margin: 2mm 0 5mm; }
  .xqr { position: relative; background: ${XT.white}; border-radius: 4mm; padding: 3mm; box-shadow: 0 1.5mm 5mm rgba(31,34,48,.14); }
  .xqr .code { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
  .xqr .c { position: absolute; width: 6mm; height: 6mm; border: 0 solid ${XT.crimson}; }
  .xqr .tl { left: -1.6mm; top: -1.6mm; border-width: .9mm 0 0 .9mm; border-top-left-radius: 3mm; }
  .xqr .tr { right: -1.6mm; top: -1.6mm; border-width: .9mm .9mm 0 0; border-top-right-radius: 3mm; }
  .xqr .bl { left: -1.6mm; bottom: -1.6mm; border-width: 0 0 .9mm .9mm; border-bottom-left-radius: 3mm; }
  .xqr .br { right: -1.6mm; bottom: -1.6mm; border-width: 0 .9mm .9mm 0; border-bottom-right-radius: 3mm; }
  .xqr .badge { position: absolute; left: 50%; top: 50%; width: 21%; height: 21%; transform: translate(-50%, -50%); background: ${XT.white}; border-radius: 2mm; padding: 1.2%; display: flex; }
  .xqr .badge img { width: 100%; height: 100%; object-fit: contain; }
  .xlabel { font-family: Manrope, "Helvetica Neue", Arial, sans-serif; font-weight: 800; color: ${XT.crimson}; font-size: 21pt; line-height: 1.05; margin-top: 3.5mm; letter-spacing: -.01em; }
  .xbody.row { flex-direction: row; justify-content: space-between; gap: 8mm; padding: 3mm 12mm 4mm; text-align: left; }
  .xtext { display: flex; flex-direction: column; align-items: flex-start; }
  .row .xlabel { font-size: 26pt; margin-top: 2mm; }
  .row .foot { padding: 3mm 0 0; text-align: left; }
  .tent .sky { padding: 3.5mm 6mm 10mm; } .tent .pines { height: 9mm; } .tent .xlogo { width: 10mm; height: 10mm; } .tent .xname { font-size: 15pt; }
  .foot { font-size: 8.5pt; color: ${XT.mute}; padding: 2mm 4mm 4mm; text-align: center; letter-spacing: .02em; }
  .dot { margin: 0 2mm; color: ${XT.crimson}; }
  .xoffer { display: inline-block; background: ${XT.crimson}; color: ${XT.white}; font-weight: 800; font-size: 14pt; border-radius: 99mm; padding: 2mm 7mm; margin-bottom: 5mm; }
  .xoffer.small { font-size: 10pt; margin: 0 auto 4mm; }
  .xsteps { list-style: none; display: flex; gap: 12mm; padding: 0; margin: 8mm 0 2mm; font-family: Staatliches, Impact, sans-serif; font-size: 15pt; letter-spacing: .08em; }
  .xsteps b { display: inline-flex; align-items: center; justify-content: center; width: 8mm; height: 8mm; border-radius: 99mm; background: ${XT.night}; color: ${XT.sand}; margin-right: 2.5mm; font-weight: 400; }
  .tent { width: 210mm; height: 148.5mm; display: flex; flex-direction: column; break-after: page; }
  .panel { flex: 1; }
  .panel.flip { transform: rotate(180deg); }
  .fold { height: 0; border-top: .3mm dashed ${XT.stone}; }
  .stickers { display: grid; grid-template-columns: repeat(2, 86mm); grid-auto-rows: 86mm; gap: 8mm; justify-content: center; padding: 12mm 0; }
  .sticker { border-radius: 7mm; border: .4mm solid ${XT.line}; break-inside: avoid; }
  .sticker .sky { padding: 3mm 4mm 9mm; } .sticker .pines { height: 8mm; } .sticker .xlogo { width: 8mm; height: 8mm; } .sticker .xname { font-size: 12pt; } .sticker .xtag, .sticker .foot { display: none; }
  .sticker .xhead { font-size: 13pt; margin-bottom: 2mm; } .sticker .eyebrow { font-size: 7.5pt; } .sticker .xlabel { font-size: 13pt; margin-top: 2.5mm; }
  .poster { width: 210mm; height: 297mm; break-after: page; }
  .standees { display: flex; flex-direction: column; }
  .standee { width: 210mm; height: 148.5mm; border-bottom: .3mm dashed #CFC3B2; break-inside: avoid; }
  .standee:nth-child(2n) { border-bottom: 0; break-after: page; }
  @media screen { body { background: #d9d3ca; } .tent, .poster, .standee, .stickers { margin: 6mm auto; box-shadow: 0 1mm 6mm rgba(0,0,0,.18); } .stickers { width: 210mm; background: ${XT.white}; } }
</style></head><body>${pages}<script>window.onload = () => (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => setTimeout(() => window.print(), 300));</script></body></html>`;
}

