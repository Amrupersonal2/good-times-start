import { existsSync, readFileSync } from "node:fs";

/** A value from the environment or the project's .env (CI has no other copy of the public Supabase keys). */
export function envValue(key: string): string {
  if (process.env[key]) return process.env[key]!;
  if (!existsSync(".env")) return "";
  const line = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith(`${key}=`));
  return (line?.slice(key.length + 1) ?? "").trim().replace(/^"|"$/g, "");
}
