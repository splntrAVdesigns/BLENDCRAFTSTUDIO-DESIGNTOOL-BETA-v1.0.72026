"use client";

import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

import { cn } from "./utils";

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

    const viewport = root.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
    if (!viewport) return;

    const enforce = () => {
      // (1) Kill the display:table measuring box (Bug A — content inflation).
      //     Also pin its width to exactly 100% of the viewport so it can
      //     never size itself to its widest descendant.
      const wrapper = viewport.firstElementChild as HTMLElement | null;
      if (wrapper) {
        if (wrapper.style.display !== 'block') wrapper.style.display = 'block';
        if (wrapper.style.width !== '100%') wrapper.style.width = '100%';
        if (wrapper.style.maxWidth !== '100%') wrapper.style.maxWidth = '100%';
      }
      // (2) Pin horizontal scroll to zero (Bug B — content displacement).
      //     `overflow-x: hidden` does NOT prevent programmatic horizontal
      //     scrolling — scrollIntoView, focus(), and browser
      //     scroll-anchoring can all shift a hidden-overflow container
      //     sideways, which clips the LEFT edge of content. Forcing
      //     scrollLeft to 0 makes that impossible no matter the source.
      if (viewport.scrollLeft !== 0) viewport.scrollLeft = 0;
    };

    enforce();

    // Re-assert on any scroll (catches programmatic horizontal scrolls the
    // instant they happen) and on any DOM change (Radix can recreate the
    // wrapper on content swaps).
    viewport.addEventListener('scroll', enforce, { passive: true });
    const observer = new MutationObserver(enforce);
    observer.observe(root, { childList: true, subtree: true });

    return () => {
      viewport.removeEventListener('scroll', enforce);
      observer.disconnect();
    };
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
