import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogTitle } from "@/components/ui/dialog";
import { VegMark } from "@/components/VegMark";
import { formatINR } from "@/lib/billing";
import { buildLine } from "@/lib/menu-logic";
import type { MenuItem, OrderType } from "@/lib/types";

/** Pick a portion (required when the dish has portions) and any add-ons. */
export function ItemOptions({ item, orderType, onAdd }: { item: MenuItem; orderType: OrderType; onAdd: (variantId: string | undefined, addonIds: string[]) => void }) {
  const [variantId, setVariantId] = useState<string | undefined>(item.variants?.[0]?.id);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const line = buildLine(item, orderType, variantId, addonIds);
  const toggle = (id: string) => setAddonIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));

  return (
    <div>
      <DialogTitle className="flex items-center gap-2"><VegMark veg={item.veg} />{item.name}</DialogTitle>
      {item.description ? <p className="mt-1 text-sm text-muted-foreground">{item.description}</p> : null}
      {item.variants?.length ? (
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold">Portion</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {item.variants.map((v) => (
              <button key={v.id} type="button" role="radio" aria-checked={variantId === v.id} onClick={() => setVariantId(v.id)}
                className={`rounded-lg border px-3 py-3 text-left ${variantId === v.id ? "border-primary bg-primary-tint" : "border-border"}`}>
                <span className="flex items-center gap-1.5 text-sm font-semibold">{v.veg !== undefined ? <VegMark veg={v.veg} /> : null}{v.name}</span>
                <span className="text-sm text-muted-foreground">{formatINR(v.price, 0)}</span>
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      {item.addons?.length ? (
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold">Add-ons</legend>
          <div className="mt-2 space-y-1.5">
            {item.addons.map((a) => (
              <label key={a.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm">
                <input type="checkbox" checked={addonIds.includes(a.id)} onChange={() => toggle(a.id)} className="size-4" />
                <span className="flex-1">{a.name}</span>
                <span className="text-muted-foreground">{a.price ? `+${formatINR(a.price, 0)}` : "Free"}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <Button className="mt-5 w-full" onClick={() => onAdd(variantId, addonIds)}>Add to bill, {formatINR(line.price, 0)}</Button>
    </div>
  );
}

