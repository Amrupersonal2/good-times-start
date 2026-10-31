import { describe, expect, it } from "vitest";
import { allowAppWorker, installKind } from "./app-install-logic";

describe("separate app installations", () => {
  it("keeps the counter, waiter and manager identities apart", () => {
    expect(installKind("/", "pos")).toBe("pos");
    expect(installKind("/waiter", "manager")).toBe("waiter");
    expect(installKind("/manager", null)).toBe("manager");
  });
  it("never caches editor previews or development", () => {
    expect(allowAppWorker(false, "localhost", false, "")).toBe(false);
    for (const host of ["id-preview--abc.lovable.app", "preview--abc.lovable.app", "lovableproject.com", "x.lovableproject-dev.com", "beta.lovable.dev"]) {
      expect(allowAppWorker(true, host, false, "")).toBe(false);
    }
    expect(allowAppWorker(true, "good-times-start.lovable.app", true, "")).toBe(false);
    expect(allowAppWorker(true, "good-times-start.lovable.app", false, "?sw=off")).toBe(false);
    expect(allowAppWorker(true, "good-times-start.lovable.app", false, "")).toBe(true);
  });
});