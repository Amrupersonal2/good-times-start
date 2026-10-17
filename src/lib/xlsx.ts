/**
 * Minimal, dependency-free Excel (.xlsx) writer and reader.
 *
 * Writer: builds an Office Open XML workbook with a small fixed style sheet
 * (bold banded header, rupee and quantity formats, dates, totals with live
 * SUM formulas, frozen header, auto-filter). Files are stored (not
 * compressed) inside the zip, which every spreadsheet app accepts.
 *
 * Reader: opens .xlsx uploads (stored or deflated entries) using the
 * browser's DecompressionStream and returns each sheet as rows of values.
 */

export type ColumnFormat = "text" | "inr" | "int" | "qty" | "pct" | "date" | "datetime";

export interface Column {
  header: string;
  /** Character width; picked from the content when left out. */
  width?: number;
  format?: ColumnFormat;
  /** Add a SUM to the totals row for this column. */
  total?: boolean;
}

export type CellValue = string | number | boolean | Date | null | undefined;

export interface SheetSpec {
  name: string;
  /** Big heading in row 1, e.g. "TAB Bistro by XTSY — Sales". */
  title?: string;
  /** Smaller line under the title, e.g. the date range. */
  subtitle?: string;
  columns: Column[];
  rows: CellValue[][];
  /** Adds a bold totals row with SUM formulas for columns marked `total`. */
  totals?: boolean;
  /** Notes printed below the table (not part of the data). */
  notes?: string[];
}

/* ---------------- styles ---------------- */

// cellXfs indexes (see STYLES_XML)
const S = {
  text: 0,
  header: 1,
  inr: 2,
  int: 3,
  pct: 4,
  date: 5,
  datetime: 6,
  title: 7,
  subtitle: 8,
  totalText: 9,
  totalInr: 10,
  totalInt: 11,
  qty: 12,
  totalQty: 13,
  note: 14,
} as const;

const DATA_STYLE: Record<ColumnFormat, number> = { text: S.text, inr: S.inr, int: S.int, qty: S.qty, pct: S.pct, date: S.date, datetime: S.datetime };
const TOTAL_STYLE: Record<ColumnFormat, number> = { text: S.totalText, inr: S.totalInr, int: S.totalInt, qty: S.totalQty, pct: S.totalText, date: S.totalText, datetime: S.totalText };

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="5">
<numFmt numFmtId="164" formatCode="&quot;₹&quot;#,##0.00;[Red]-&quot;₹&quot;#,##0.00"/>
<numFmt numFmtId="165" formatCode="dd-mmm-yyyy"/>
<numFmt numFmtId="166" formatCode="dd-mmm-yyyy hh:mm"/>
<numFmt numFmtId="167" formatCode="0.0%"/>
<numFmt numFmtId="168" formatCode="#,##0.###"/>
</numFmts>
<fonts count="6">
<font><sz val="11"/><color rgb="FF17352E"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="16"/><color rgb="FF17352E"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF5B6F69"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF17352E"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="9"/><color rgb="FF5B6F69"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F4D42"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFDF1DC"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFD5DDD9"/></bottom><diagonal/></border>
<border><left/><right/><top style="medium"><color rgb="FF1F4D42"/></top><bottom style="medium"><color rgb="FF1F4D42"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="4" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="3" fontId="4" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="168" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="168" fontId="4" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="0"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/* ---------------- helpers ---------------- */

export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function escapeXml(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex -- strip characters XML 1.0 forbids
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Excel serial date in local time (so 17-Oct 9:30 pm stays 17-Oct 9:30 pm in the sheet). */
export function excelDate(value: Date | number): number {
  const ms = typeof value === "number" ? value : value.getTime();
  const offset = new Date(ms).getTimezoneOffset() * 60000;
  return (ms - offset) / 86400000 + 25569;
}

/** Sheet names: max 31 characters, none of []:*?/\ and unique within the workbook. */
export function safeSheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base = (raw.replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim() || "Sheet").slice(0, 31);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function cellXml(ref: string, value: CellValue, style: number, format: ColumnFormat): string {
  if (value === null || value === undefined || value === "") return style ? `<c r="${ref}" s="${style}"/>` : "";
  if (value instanceof Date) return `<c r="${ref}" s="${style}"><v>${excelDate(value)}</v></c>`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return `<c r="${ref}" s="${style}"/>`;
    const v = format === "date" || format === "datetime" ? excelDate(value) : value;
    return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
  }
  if (typeof value === "boolean") return `<c r="${ref}" s="${style}" t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function displayLength(value: CellValue, format: ColumnFormat): number {
  if (value === null || value === undefined) return 0;
  if (format === "date") return 11;
  if (format === "datetime") return 17;
  if (typeof value === "number") return format === "inr" ? String(Math.round(value)).length + 6 : String(value).length + 1;
  return String(value).length;
}

function sheetXml(spec: SheetSpec): string {
  const cols = spec.columns;
  const lastCol = columnLetter(Math.max(0, cols.length - 1));
  const rowsXml: string[] = [];
  let r = 0;
  const merges: string[] = [];

  if (spec.title) {
    r += 1;
    rowsXml.push(`<row r="${r}" ht="24" customHeight="1">${cellXml(`A${r}`, spec.title, S.title, "text")}</row>`);
    if (cols.length > 1) merges.push(`A${r}:${lastCol}${r}`);
  }
  if (spec.subtitle) {
    r += 1;
    rowsXml.push(`<row r="${r}">${cellXml(`A${r}`, spec.subtitle, S.subtitle, "text")}</row>`);
    if (cols.length > 1) merges.push(`A${r}:${lastCol}${r}`);
  }
  if (spec.title || spec.subtitle) r += 1; // breathing room

  r += 1;
  const headerRow = r;
  rowsXml.push(`<row r="${r}" ht="20" customHeight="1">${cols.map((c, i) => cellXml(`${columnLetter(i)}${r}`, c.header, S.header, "text")).join("")}</row>`);

  const firstData = r + 1;
  for (const row of spec.rows) {
    r += 1;
    const cells = cols.map((c, i) => cellXml(`${columnLetter(i)}${r}`, row[i], DATA_STYLE[c.format ?? "text"], c.format ?? "text")).join("");
    rowsXml.push(`<row r="${r}">${cells}</row>`);
  }
  const lastData = r;

  if (spec.totals && spec.rows.length) {
    r += 1;
    const cells = cols.map((c, i) => {
      const ref = `${columnLetter(i)}${r}`;
      const style = TOTAL_STYLE[c.format ?? "text"];
      if (i === 0 && !c.total) return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>Total</t></is></c>`;
      if (!c.total) return `<c r="${ref}" s="${style}"/>`;
      const sum = spec.rows.reduce((s, row) => s + (typeof row[i] === "number" ? (row[i] as number) : 0), 0);
      const L = columnLetter(i);
      return `<c r="${ref}" s="${style}"><f>SUM(${L}${firstData}:${L}${lastData})</f><v>${Math.round(sum * 1000) / 1000}</v></c>`;
    }).join("");
    rowsXml.push(`<row r="${r}">${cells}</row>`);
  }

  if (spec.notes?.length) r += 1; // blank row before notes
  for (const note of spec.notes ?? []) {
    r += 1;
    rowsXml.push(`<row r="${r}">${cellXml(`A${r}`, note, S.note, "text")}</row>`);
  }

  const widths = cols.map((c, i) => {
    if (c.width) return c.width;
    let w = c.header.length + 2;
    for (const row of spec.rows.slice(0, 500)) w = Math.max(w, displayLength(row[i], c.format ?? "text") + 2);
    return Math.min(60, Math.max(8, w));
  });

  const filterRef = `A${headerRow}:${lastCol}${Math.max(headerRow, lastData)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="16"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${rowsXml.join("")}</sheetData>
${spec.rows.length ? `<autoFilter ref="${filterRef}"/>` : ""}
${merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : ""}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

/* ---------------- zip (store) ---------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function zipStore(files: { name: string; data: Uint8Array }[], when = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(when);
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = enc.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 names
    lh.setUint16(8, 0, true); // stored
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    local.push(new Uint8Array(lh.buffer), name, file.data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);

    offset += 30 + name.length + size;
  }

  const centralSize = central.reduce((s, part) => s + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/* ---------------- workbook ---------------- */

export interface WorkbookMeta { title?: string; author?: string }

export function buildXlsx(specs: SheetSpec[], meta: WorkbookMeta = {}): Uint8Array {
  if (!specs.length) throw new Error("A workbook needs at least one sheet.");
  const enc = new TextEncoder();
  const names = safeSheetNames(specs.map((s) => s.name));
  const now = new Date();

  const definedNames = specs
    .map((s, i) => {
      if (!s.rows.length) return "";
      const header = (s.title ? 1 : 0) + (s.subtitle ? 1 : 0) + (s.title || s.subtitle ? 1 : 0) + 1;
      const last = header + s.rows.length;
      const sheetRef = `'${names[i]!.replace(/'/g, "''")}'`;
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${escapeXml(`${sheetRef}!$A$${header}:$${columnLetter(s.columns.length - 1)}$${last}`)}</definedName>`;
    })
    .join("");

  const files: { name: string; data: Uint8Array }[] = [
    {
      name: "[Content_Types].xml",
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
${specs.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`),
    },
    {
      name: "_rels/.rels",
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`),
    },
    {
      name: "docProps/core.xml",
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeXml(meta.title ?? "XTSY POS export")}</dc:title>
<dc:creator>${escapeXml(meta.author ?? "XTSY POS")}</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created>
</cp:coreProperties>`),
    },
    {
      name: "xl/workbook.xml",
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000"/></bookViews>
<sheets>${names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
${definedNames ? `<definedNames>${definedNames}</definedNames>` : ""}
</workbook>`),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${specs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${specs.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    },
    { name: "xl/styles.xml", data: enc.encode(STYLES_XML) },
    ...specs.map((spec, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(spec)) })),
  ];
  return zipStore(files, now);
}

/** Save a workbook from the browser. */
export function downloadXlsx(fileName: string, specs: SheetSpec[], meta?: WorkbookMeta): void {
  const bytes = buildXlsx(specs, meta);
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------------- reader ---------------- */

export type ReadValue = string | number | boolean | null;
export interface ReadSheet { name: string; rows: ReadValue[][] }

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open compressed Excel files. Update your browser and try again.");
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("This isn't an Excel (.xlsx) file.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("The Excel file is damaged.");
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + compSize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

function allText(fragment: string): string {
  return [...fragment.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => unescapeXml(m[1] ?? "")).join("");
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

/** Read every sheet of an .xlsx file as rows of plain values (dates come back as Excel serial numbers). */
export async function readXlsx(input: ArrayBuffer | Uint8Array): Promise<ReadSheet[]> {
  const files = await unzip(input instanceof Uint8Array ? input : new Uint8Array(input));
  const dec = new TextDecoder();
  const text = (path: string) => { const f = files.get(path); return f ? dec.decode(f) : ""; };

  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => allText(m[1] ?? ""));
  const rels = new Map([...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\s[^>]*>/g)].map((m) => [attr(m[0], "Id") ?? "", attr(m[0], "Target") ?? ""]));
  const sheets = [...text("xl/workbook.xml").matchAll(/<sheet\s[^>]*\/?>/g)].map((m) => ({
    name: unescapeXml(attr(m[0], "name") ?? "Sheet"),
    target: rels.get(attr(m[0], "r:id") ?? "") ?? "",
  }));

  return sheets.map(({ name, target }) => {
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const xml = text(path);
    const rows: ReadValue[][] = [];
    for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rowNumber = Number(attr(`<row${rowMatch[1] ?? ""}>`, "r")) || rows.length + 1;
      const row: ReadValue[] = [];
      for (const cell of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const head = `<c${cell[1] ?? ""}>`;
        const ref = attr(head, "r") ?? "";
        const col = ref ? columnIndex(ref.replace(/\d+/g, "")) : row.length;
        const type = attr(head, "t");
        const body = cell[2] ?? "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value: ReadValue = null;
        if (type === "s") value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = allText(body);
        else if (type === "str") value = v !== undefined ? unescapeXml(v) : "";
        else if (type === "b") value = v === "1";
        else if (type === "e") value = null;
        else if (v !== undefined) value = Number(v);
        row[col] = value;
      }
      for (let i = 0; i < row.length; i += 1) if (row[i] === undefined) row[i] = null;
      rows[rowNumber - 1] = row;
    }
    for (let i = 0; i < rows.length; i += 1) if (!rows[i]) rows[i] = [];
    return { name, rows };
  });
}
