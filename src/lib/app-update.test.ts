import { describe, expect, it } from "vitest";
import { assetsInHtml, canUpdateUnattended, isNewerBuild } from "./app-update";

const page = (hash: string) => `<!doctype html><link rel="modulepreload" href="/assets/index-${hash}.js"><link rel="stylesheet" href="/assets/styles-${hash}.css"><script type="module" src="/assets/client-${hash}.js"></script>`;

describe("app update check", () => {
  it("reads the hashed files a page loads", () => {
    expect(assetsInHtml(page("AbC1"))).toEqual(["/assets/client-AbC1.js", "/assets/index-AbC1.js", "/assets/styles-AbC1.css"]);
  });
  it("spots a newer published build", () => {
    expect(isNewerBuild(assetsInHtml(page("new2")), assetsInHtml(page("old1")))).toBe(true);
  });
  it("stays put when the device already runs the live build", () => {
    const loaded = [...assetsInHtml(page("same")), "/assets/reports-zz9.js"];
    expect(isNewerBuild(assetsInHtml(page("same")), loaded)).toBe(false);
  });
  it("never reloads on an empty or unreadable page", () => {
    expect(isNewerBuild([], assetsInHtml(page("x")))).toBe(false);
    expect(isNewerBuild(assetsInHtml(page("x")), [])).toBe(false);
  });
  it("updates by itself only when nobody is mid-task", () => {
    expect(canUpdateUnattended({ hidden: true, idleMs: 0, dialogOpen: false })).toBe(true);
    expect(canUpdateUnattended({ hidden: false, idleMs: 3 * 60_000, dialogOpen: false })).toBe(true);
    expect(canUpdateUnattended({ hidden: false, idleMs: 30_000, dialogOpen: false })).toBe(false);
    expect(canUpdateUnattended({ hidden: true, idleMs: 10 * 60_000, dialogOpen: true })).toBe(false);
  });
});
