import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

/**
 * Whether the surrounding popover is open. Closed popovers render nothing (no
 * Radix Presence instance) and open ones force-mount, which avoids Presence's
 * React 19 "Maximum update depth exceeded" loop. See ui/dialog.tsx.
 */
const PopoverOpenContext = React.createContext<boolean | null>(null);

type PopoverProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>;

function Popover({ open: openProp, defaultOpen, onOpenChange, ...props }: PopoverProps) {
  const [innerOpen, setInnerOpen] = React.useState(defaultOpen ?? false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : innerOpen;
  const latest = React.useRef(onOpenChange);
  latest.current = onOpenChange;
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!controlled) setInnerOpen(next);
      latest.current?.(next);
    },
    [controlled],
  );
  return (
    <PopoverOpenContext.Provider value={open}>
      <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange} {...props} />
    </PopoverOpenContext.Provider>
  );
}

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => {
  const open = React.useContext(PopoverOpenContext);
  if (open === false) return null;
  return (
    <PopoverPrimitive.Portal forceMount>
      <PopoverPrimitive.Content
        ref={ref}
        forceMount
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-(--radix-popover-content-transform-origin)",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
