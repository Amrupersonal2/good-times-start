import { inflateRawSync } from "node:zlib";

/** Entries of a .zip (an .xlsx is one), read from the central directory. */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("Not a zip file (no end of central directory)");
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Broken zip directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    out.set(name, method === 0 ? raw : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Sheet names and every text value in an .xlsx, enough to check what's inside. */
export function readXlsx(buf: Buffer): { sheets: string[]; text: string; rows: number } {
  const files = unzip(buf);
  const workbook = files.get("xl/workbook.xml")?.toString("utf8");
  if (!workbook) throw new Error("No xl/workbook.xml: not an Excel file");
  const sheets = [...workbook.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((m) => decode(m[1] ?? ""));
  let text = "";
  let rows = 0;
  for (const [name, data] of files) {
    if (!/^xl\/(worksheets\/sheet\d+|sharedStrings)\.xml$/.test(name)) continue;
    const xml = data.toString("utf8");
    rows += (xml.match(/<row[ >]/g) ?? []).length;
    text += ` ${[...xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => decode(m[1] ?? "")).join(" ")}`;
    text += ` ${[...xml.matchAll(/<v>([^<]*)<\/v>/g)].map((m) => m[1]).join(" ")}`;
  }
  return { sheets, text, rows };
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** CSV rows (simple quoted CSV as the app writes it). */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}
