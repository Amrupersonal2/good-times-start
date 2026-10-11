export function VegMark({ veg }: { veg: boolean }) {
  return (
    <span
      role="img"
      aria-label={veg ? "Vegetarian" : "Non-vegetarian"}
      className={`inline-flex size-3.5 shrink-0 items-center justify-center rounded-[2px] border-[1.5px] ${veg ? "border-success" : "border-destructive"}`}
    >
      <span className={`size-1.5 rounded-full ${veg ? "bg-success" : "bg-destructive"}`} />
    </span>
  );
}
