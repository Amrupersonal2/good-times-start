export interface DropdownOption<V extends string | number = string> {
  value: V;
  label: string;
  /** Quiet text on the right, e.g. a unit or a section. */
  hint?: string;
  /** Options with the same group are listed under one heading. */
  group?: string;
  disabled?: boolean;
}

/** Options in groups, keeping the order the groups first appear in. */
export function dropdownGroups<V extends string | number>(options: DropdownOption<V>[]): [string, DropdownOption<V>[]][] {
  const out = new Map<string, DropdownOption<V>[]>();
  for (const o of options) out.set(o.group ?? "", [...(out.get(o.group ?? "") ?? []), o]);
  return [...out.entries()];
}

/** Search by any word start or anywhere in the label; word starts rank first. Groups stay together. */
export function filterOptions<V extends string | number>(options: DropdownOption<V>[], query: string): DropdownOption<V>[] {
  const q = query.trim().toLowerCase();
  if (!q) return dropdownGroups(options).flatMap(([, items]) => items);
  const score = (o: DropdownOption<V>) => {
    const text = `${o.label} ${o.hint ?? ""} ${o.group ?? ""}`.toLowerCase();
    if (text.startsWith(q)) return 0;
    if (text.split(/[\s(/-]+/).some((w) => w.startsWith(q))) return 1;
    return text.includes(q) ? 2 : -1;
  };
  return options.map((o) => [o, score(o)] as const).filter(([, s]) => s >= 0).sort((a, b) => a[1] - b[1]).map(([o]) => o);
}
