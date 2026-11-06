/**
 * Automated browsers (the regression suite, build tools' checks) must not
 * count as QR scans or register as terminals, or they distort the owner's numbers.
 */
export function isTestBrowser(): boolean {
  if (typeof window === "undefined") return false;
  try { if (window.localStorage.getItem("xtsy-regression") === "1") return true; } catch { /* storage unavailable */ }
  return typeof navigator !== "undefined" && navigator.webdriver === true;
}
