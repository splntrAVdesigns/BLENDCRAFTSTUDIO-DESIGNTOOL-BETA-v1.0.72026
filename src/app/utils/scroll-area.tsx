"use client";

import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

import { cn } from "../components/ui/utils";

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  // STAGE 2.6 FIX (sidebar cropping — reapplied): confirmed against the
  // installed @radix-ui/react-scroll-area source that Viewport wraps its
  // children in an internal <div style="min-width:100%;display:table">.
  // Table layout sizes to the WIDEST descendant's natural content width,
  // not the container — so any row anywhere inside a ScrollArea can
  // silently inflate that box past its visible bounds, and flex/percentage
  // children (e.g. `truncate`) then compute against the INFLATED width
  // instead of the real one — text clips instead of ellipsizing.
  //
  // BELT AND SUSPENDERS: this exact fix was previously shipped as a
  // Tailwind arbitrary-variant class (`[&>div]:!block`) and at some point
  // reverted to the original unpatched file before this round of testing —
  // whether from a manual edit, a stale save, or a build-pipeline quirk
  // that dropped the compiled utility isn't fully known. Rather than trust
  // a single mechanism a second time, this now ALSO enforces the fix via
  // direct DOM manipulation in a layout effect, which has zero dependency
  // on Tailwind's JIT correctly generating that specific selector — it
  // will work even if the CSS class is ever stripped, misconfigured, or
  // fails to compile in an unfamiliar build environment.
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const enforceBlock = () => {
      const viewport = root.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
      const injectedWrapper = viewport?.firstElementChild as HTMLElement | null;
      if (injectedWrapper && injectedWrapper.style.display !== 'block') {
        injectedWrapper.style.display = 'block';
      }
    };

    enforceBlock();
    // Radix can recreate this wrapper on certain re-renders (content swap,
    // orientation changes) — a MutationObserver re-applies the fix any time
    // that happens, so it survives for the lifetime of this ScrollArea
    // rather than only at mount.
    const observer = new MutationObserver(enforceBlock);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <ScrollAreaPrimitive.Root
      ref={rootRef}
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1 [&>div]:!block"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
