const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** GSTIN checksum (last character), per the GSTN mod-36 scheme. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = GSTIN_CHARS.indexOf(first14[i] ?? "");
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] ?? "";
}

/** Returns an error message, or "" when the GSTIN is empty or valid. */
export function gstinError(raw: string): string {
  const gstin = raw.trim().toUpperCase();
  if (!gstin) return "";
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return "A GSTIN has 15 characters, like 17AAAAA0000A1Z5.";
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) return "This GSTIN's last character doesn't match. Check it for a typo.";
  return "";
}

export function fssaiError(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  return /^[0-9]{14}$/.test(value) ? "" : "An FSSAI licence number has 14 digits.";
}

export function upiError(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/.test(value) ? "" : "A UPI ID looks like yourname@bank.";
}

export function emailError(raw: string): string {
  const value = raw.trim();
  if (!value) return "Enter an email address.";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? "" : "Enter a valid email address.";
}
