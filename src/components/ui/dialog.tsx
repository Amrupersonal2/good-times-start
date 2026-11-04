"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Self-contained modal dialog (no Radix). Radix Dialog's Presence/compose-refs
 * ref callbacks re-ran setState on every commit under React 19 and caused
 * "Maximum update depth exceeded" blank screens, so this keeps the same API
 * with plain React: closed dialogs render nothing, open ones portal to <body>.
 */
type Ctx = { open: boolean; setOpen: (open: boolean) => void; titleId: string; descId: string };
const DialogContext = React.createContext<Ctx | null>(null);
const useDialog = () => React.useContext(DialogContext);

export interface DialogProps {
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  modal?: boolean | undefined;
  children?: React.ReactNode;
}

function Dialog({ open: openProp, defaultOpen, onOpenChange, children }: DialogProps) {
  const [innerOpen, setInnerOpen] = React.useState(defaultOpen ?? false);
  const controlled = openProp !== undefined;
  const open = controlled ? !!openProp : innerOpen;
  const latest = React.useRef(onOpenChange);
  latest.current = onOpenChange;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!controlled) setInnerOpen(next);
      latest.current?.(next);
    },
    [controlled],
  );
  const titleId = React.useId();
  const descId = React.useId();
  const value = React.useMemo(() => ({ open, setOpen, titleId, descId }), [open, setOpen, titleId, descId]);
  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

type Buttonish = React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean };

function withClick(props: Buttonish, action: () => void, ref: React.Ref<HTMLButtonElement>) {
  const { asChild, children, onClick, ...rest } = props;
  const handle = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    if (!e.defaultPrevented) action();
  };
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void }>;
    return React.cloneElement(child, {
      ...rest,
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
        child.props.onClick?.(e);
        handle(e);
      },
    } as Record<string, unknown>);
  }
  return (
    <button ref={ref} type="button" {...rest} onClick={handle}>
      {children}
    </button>
  );
}

const DialogTrigger = React.forwardRef<HTMLButtonElement, Buttonish>((props, ref) => {
  const ctx = useDialog();
  return withClick(props, () => ctx?.setOpen(true), ref);
});
DialogTrigger.displayName = "DialogTrigger";

const DialogClose = React.forwardRef<HTMLButtonElement, Buttonish>((props, ref) => {
  const ctx = useDialog();
  return withClick(props, () => ctx?.setOpen(false), ref);
});
DialogClose.displayName = "DialogClose";

function DialogPortal({ children }: { children?: React.ReactNode; forceMount?: boolean }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

const DialogOverlay = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { forceMount?: boolean }>(
  ({ className, forceMount: _f, ...props }, ref) => (
    <div
      ref={ref}
      data-state="open"
      className={cn("fixed inset-0 z-50 bg-black/80 animate-in fade-in-0", className)}
      {...props}
    />
  ),
);
DialogOverlay.displayName = "DialogOverlay";

type PreventableEvent = { preventDefault: () => void; defaultPrevented: boolean };
const makeEvent = (): PreventableEvent => {
  const ev = { defaultPrevented: false, preventDefault: () => { ev.defaultPrevented = true; } };
  return ev;
};

// Stack of open dialogs so Escape only closes the top-most one.
const openStack: symbol[] = [];
const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  forceMount?: boolean;
  onEscapeKeyDown?: (e: KeyboardEvent) => void;
  onPointerDownOutside?: (e: PreventableEvent) => void;
  onInteractOutside?: (e: PreventableEvent) => void;
  onOpenAutoFocus?: (e: PreventableEvent) => void;
  onCloseAutoFocus?: (e: PreventableEvent) => void;
}

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, forceMount: _f, onEscapeKeyDown, onPointerDownOutside, onInteractOutside, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
    const ctx = useDialog();
    const open = ctx ? ctx.open : true;
    const innerRef = React.useRef<HTMLDivElement | null>(null);
    const handlers = React.useRef({ onEscapeKeyDown, onOpenAutoFocus, onCloseAutoFocus, ctx });
    handlers.current = { onEscapeKeyDown, onOpenAutoFocus, onCloseAutoFocus, ctx };

    const setRefs = React.useCallback(
      (node: HTMLDivElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      },
      [ref],
    );

    React.useEffect(() => {
      if (!open) return;
      const id = Symbol("dialog");
      openStack.push(id);
      const previous = document.activeElement as HTMLElement | null;
      const overflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const ev = makeEvent();
      handlers.current.onOpenAutoFocus?.(ev);
      if (!ev.defaultPrevented) {
        const node = innerRef.current;
        if (node && !node.contains(document.activeElement)) {
          const auto = node.querySelector<HTMLElement>("[autofocus]") ?? node.querySelector<HTMLElement>(FOCUSABLE);
          (auto ?? node).focus({ preventScroll: true });
        }
      }
      const onKey = (e: KeyboardEvent) => {
        if (openStack[openStack.length - 1] !== id) return;
        if (e.key === "Escape") {
          handlers.current.onEscapeKeyDown?.(e);
          if (!e.defaultPrevented) handlers.current.ctx?.setOpen(false);
        } else if (e.key === "Tab" && innerRef.current) {
          const items = Array.from(innerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
          if (!items.length) return;
          const first = items[0]!, last = items[items.length - 1]!;
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("keydown", onKey);
        const i = openStack.indexOf(id);
        if (i >= 0) openStack.splice(i, 1);
        if (!openStack.length) document.body.style.overflow = overflow;
        const closeEv = makeEvent();
        handlers.current.onCloseAutoFocus?.(closeEv);
        if (!closeEv.defaultPrevented && previous && document.contains(previous)) previous.focus({ preventScroll: true });
      };
    }, [open]);

    if (!open) return null;

    const outside = () => {
      const ev = makeEvent();
      onPointerDownOutside?.(ev);
      onInteractOutside?.(ev);
      if (!ev.defaultPrevented) ctx?.setOpen(false);
    };

    return (
      <DialogPortal>
        <DialogOverlay onPointerDown={(e) => { if (e.target === e.currentTarget) outside(); }} />
        <div
          ref={setRefs}
          role="dialog"
          aria-modal="true"
          aria-labelledby={ctx?.titleId}
          aria-describedby={ctx?.descId}
          tabIndex={-1}
          data-state="open"
          className={cn(
            "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 outline-none animate-in fade-in-0 zoom-in-95 sm:rounded-lg",
            className,
          )}
          {...props}
        >
          {children}
          <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background cursor-pointer transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>
      </DialogPortal>
    );
  },
);
DialogContent.displayName = "DialogContent";

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => {
    const ctx = useDialog();
    return <h2 ref={ref} id={ctx?.titleId} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />;
  },
);
DialogTitle.displayName = "DialogTitle";

const DialogDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => {
    const ctx = useDialog();
    return <p ref={ref} id={ctx?.descId} className={cn("text-sm text-muted-foreground", className)} {...props} />;
  },
);
DialogDescription.displayName = "DialogDescription";

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
