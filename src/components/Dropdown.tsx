import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { dropdownGroups, filterOptions, type DropdownOption } from "@/lib/dropdown-logic";

export type { DropdownOption } from "@/lib/dropdown-logic";

/** Radix menus can't hold an empty value, so "no choice" travels under this key. */
const EMPTY = "__none__";
const encode = (v: string | number) => (v === "" ? EMPTY : String(v));

interface DropdownProps<V extends string | number> {
  value: V;
  onChange: (value: V) => void;
  options: DropdownOption<V>[];
  placeholder?: string | undefined;
  ariaLabel?: string | undefined;
  /** "sm" sits inside rows and bill lines; "md" is a full form field. */
  size?: "sm" | "md";
  /** Adds a search box. On by default for lists longer than 12. */
  searchable?: boolean;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/**
 * The app's one dropdown. Short lists open a native-feeling menu; long ones
 * (ingredients, tables) open with a search box so the right item is two keys away.
 */
export function Dropdown<V extends string | number>({ value, onChange, options, placeholder = "Choose", ariaLabel, size = "md", searchable, disabled, className }: DropdownProps<V>) {
  const long = searchable ?? options.length > 12;
  const height = size === "sm" ? "h-8 rounded-lg px-2.5 text-[13px]" : "h-10";
  if (long) return <SearchDropdown {...{ value, onChange, options, placeholder, ariaLabel, disabled, className: cn(height, className) }} />;
  const groups = dropdownGroups(options);
  return (
    <Select value={encode(value)} disabled={disabled ?? false} onValueChange={(raw) => {
      const picked = options.find((o) => encode(o.value) === raw);
      if (picked) onChange(picked.value);
    }}>
      <SelectTrigger aria-label={ariaLabel} className={cn(height, className)}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {groups.map(([group, items]) => (
          <SelectGroup key={group || "_"}>
            {group ? <SelectLabel>{group}</SelectLabel> : null}
            {items.map((o) => (
              <SelectItem key={encode(o.value)} value={encode(o.value)} disabled={o.disabled ?? false}>
                {o.label}{o.hint ? <span className="ml-2 text-xs opacity-60">{o.hint}</span> : null}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

function SearchDropdown<V extends string | number>({ value, onChange, options, placeholder, ariaLabel, disabled, className }: Omit<DropdownProps<V>, "size" | "searchable">) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const current = options.find((o) => o.value === value);
  const shown = useMemo(() => filterOptions(options, q), [options, q]);
  const pick = (o: DropdownOption<V>) => { onChange(o.value); setOpen(false); setQ(""); };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); setActive(0); }}>
      <PopoverTrigger asChild>
        <button type="button" role="combobox" aria-expanded={open} aria-label={ariaLabel} disabled={disabled}
          className={cn("flex w-full min-w-0 items-center justify-between gap-2 rounded-[10px] border border-input bg-card px-3 text-left text-sm shadow-[0_1px_1px_rgba(0,0,0,0.04)] transition-colors hover:bg-secondary/40 focus:outline-none focus-visible:ring-4 focus-visible:ring-ring/25 disabled:opacity-50", open && "border-ring ring-4 ring-ring/15", className)}>
          <span className={cn("truncate", !current && "text-muted-foreground")}>{current?.label ?? placeholder}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[max(var(--radix-popover-trigger-width),16rem)] overflow-hidden rounded-xl border-border/60 bg-popover/95 p-0 shadow-[0_10px_38px_-10px_rgba(0,0,0,0.25)] backdrop-blur-xl">
        <div className="flex items-center gap-2 border-b border-border/70 px-3">
          <Search className="size-4 text-muted-foreground" />
          <input autoFocus value={q} placeholder="Search" aria-label="Search options"
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === "Enter") { e.preventDefault(); const o = shown[active]; if (o && !o.disabled) pick(o); }
            }}
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        </div>
        <ul role="listbox" className="max-h-72 overflow-y-auto p-1">
          {shown.length ? shown.map((o, i) => {
            const prevGroup = i > 0 ? shown[i - 1]?.group : undefined;
            return (
              <li key={encode(o.value)}>
                {o.group && o.group !== prevGroup ? <p className="px-2.5 pb-1 pt-2 text-xs font-semibold text-muted-foreground">{o.group}</p> : null}
                <button type="button" role="option" aria-selected={o.value === value} disabled={o.disabled}
                  onMouseEnter={() => setActive(i)} onClick={() => pick(o)}
                  className={cn("relative flex w-full items-center rounded-[7px] py-2 pl-8 pr-3 text-left text-sm disabled:opacity-50", i === active ? "bg-primary text-primary-foreground" : "")}>
                  {o.value === value ? <Check className="absolute left-2.5 size-3.5" /> : null}
                  <span className="truncate">{o.label}</span>
                  {o.hint ? <span className="ml-auto pl-3 text-xs opacity-60">{o.hint}</span> : null}
                </button>
              </li>
            );
          }) : <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
