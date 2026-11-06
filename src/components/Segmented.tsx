import { cn } from "@/lib/utils";

/**
 * iOS-style segmented control: one choice from a few (order type, tabs,
 * date range). Scrolls sideways on small screens instead of wrapping.
 */
export function Segmented<V extends string | number>({ value, onChange, options, ariaLabel, size = "md", className, stretch }: {
  value: V;
  onChange: (value: V) => void;
  options: { value: V; label: string; badge?: number }[];
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
  /** Fill the width with equal segments. */
  stretch?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel}
      className={cn("no-scrollbar inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[10px] bg-secondary p-0.5", stretch && "flex w-full", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={cn("shrink-0 whitespace-nowrap rounded-[8px] font-semibold transition-[background,box-shadow,color] duration-150",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-[13px]",
              stretch && "flex-1",
              on ? "bg-card text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)]" : "text-muted-foreground hover:text-foreground")}>
            {o.label}{o.badge ? <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{o.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
