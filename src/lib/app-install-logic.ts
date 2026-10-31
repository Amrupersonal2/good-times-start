import type { AppKind } from "./staff-login-logic";

export type InstallKind = AppKind;

export function installKind(pathname: string, chosen: AppKind | null): InstallKind {
  if (pathname === "/waiter" || pathname.startsWith("/waiter/")) return "waiter";
  if (pathname === "/manager" || pathname.startsWith("/manager/")) return "manager";
  return chosen ?? "pos";
}

export function allowAppWorker(production: boolean, hostname: string, framed: boolean, search: string): boolean {
  return production && !framed && new URLSearchParams(search).get("sw") !== "off" &&
    !hostname.startsWith("id-preview--") && !hostname.startsWith("preview--") &&
    !["lovableproject.com", "lovableproject-dev.com", "beta.lovable.dev"].some((host) => hostname === host || hostname.endsWith(`.${host}`));
}