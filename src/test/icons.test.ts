import { describe, expect, it } from "vitest";

/**
 * Icons the live app already builds with. A misspelt or retired icon name
 * breaks the whole build, and the type-check here can't see the icon library,
 * so new icons must be checked against the installed lucide-react and added here.
 */
const KNOWN_ICONS = new Set([
  "AlertTriangle", "ArrowDownRight", "ArrowLeft", "ArrowLeftRight", "ArrowRight", "ArrowRightLeft", "ArrowUpRight", "BadgePercent", "Ban",
  "Banknote", "BarChart3", "Bell", "BellRing", "Building2", "Check", "ChefHat", "ChevronDown", "ChevronDownIcon", "ChevronLeft",
  "ChevronLeftIcon", "ChevronRight", "ChevronRightIcon", "ChevronUp", "Circle", "ClipboardList", "Clock", "Combine", "Copy", "CreditCard",
  "Download", "ExternalLink", "FileSpreadsheet", "Gift", "GripVertical", "HandCoins", "IndianRupee", "LayoutDashboard", "LayoutGrid",
  "LineChart", "LogIn", "LogOut", "MapPin", "Minus", "MoreHorizontal", "Package", "PanelLeft", "PanelLeftClose", "PanelLeftOpen", "Pencil",
  "Phone", "Plus", "Printer", "QrCode", "Receipt", "ReceiptText", "RefreshCw", "Search", "Send", "Settings", "Share", "ShieldCheck",
  "ShoppingBag", "Smartphone", "Sparkles", "Star", "Store", "Tablet", "Trash2", "Upload", "UserPlus", "UserRound", "Users",
  "UtensilsCrossed", "Wallet", "Wifi", "WifiOff", "X", "XCircle",
]);

interface Fs { readdirSync: (p: string) => string[]; readFileSync: (p: string, e: "utf8") => string; statSync: (p: string) => { isDirectory: () => boolean } }

function files(fs: Fs, dir: string): string[] {
  return fs.readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    return fs.statSync(path).isDirectory() ? files(fs, path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("icons", () => {
  it("only uses icons the live build already has", async () => {
    const fsModule = "node:fs";
    const fs = (await import(/* @vite-ignore */ fsModule)) as Fs;
    const unknown: string[] = [];
    for (const file of files(fs, "src")) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/import \{([^}]*)\} from "lucide-react"/g)) {
        for (const raw of (m[1] ?? "").split(",")) {
          const name = raw.trim().split(/\s+as\s+/)[0]?.replace(/^type\s+/, "").trim();
          if (name && !KNOWN_ICONS.has(name)) unknown.push(`${file}: ${name}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });
});
