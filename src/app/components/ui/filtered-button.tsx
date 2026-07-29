import * as React from "react";
import { filterFigmaProps } from "../../utils/filterProps";

/**
 * A simple button wrapper that filters Figma inspector props
 * Use this when you need a raw button element that works with asChild patterns
 */
export const FilteredButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button">
>((props, ref) => {
  const cleanProps = filterFigmaProps(props);
  return <button ref={ref} {...cleanProps} />;
});

FilteredButton.displayName = "FilteredButton";
