/**
 * Refuse oversized lists before schema validation runs: validating a huge array element by element
 * can exhaust server memory (zod advisory GHSA-mrhx-c7xc-m3w5), so length limits are checked first.
 */
export function rejectOversizedLists(input: unknown, limits: Record<string, number>): unknown {
  if (input && typeof input === "object") {
    for (const [key, max] of Object.entries(limits)) {
      const value = (input as Record<string, unknown>)[key];
      if (Array.isArray(value) && value.length > max) throw new Error(`Too many ${key}: at most ${max} per request.`);
    }
  }
  return input;
}
