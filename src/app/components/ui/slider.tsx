"use client";

import * as React from "react";

import { cn } from "./utils";
import { filterFigmaProps } from "../../utils/filterProps";

type SliderProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange"> & {
  value?: number[];
  defaultValue?: number[];
  min?: number;
  max?: number;
  step?: number;
  onValueChange?: (value: number[]) => void;
  onValueCommit?: (value: number[]) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  onValueCommit,
  disabled,
  ...props
}: SliderProps) {
  const initial = (value ?? defaultValue ?? [min])[0] ?? min;
  const [internalValue, setInternalValue] = React.useState<number>(initial);
  const isDraggingRef = React.useRef(false);

  React.useEffect(() => {
    if (!isDraggingRef.current && value && typeof value[0] === "number") {
      setInternalValue(clamp(value[0], min, max));
    }
  }, [value, min, max]);

  const updateLiveValue = React.useCallback(
    (nextRaw: number) => {
      const next = clamp(nextRaw, min, max);
      setInternalValue(next);
      onValueChange?.([next]);
    },
    [min, max, onValueChange]
  );

  const commit = React.useCallback(
    (nextRaw: number) => {
      const next = clamp(nextRaw, min, max);
      isDraggingRef.current = false;
      setInternalValue(next);
      onValueCommit?.([next]);
    },
    [min, max, onValueCommit]
  );

  const trackPercent = Math.min(
    100,
    Math.max(0, ((internalValue - min) / Math.max(max - min, 0.0001)) * 100)
  );

  return (
    <div
      data-slot="slider"
      className={cn("relative flex w-full items-center select-none data-[disabled]:opacity-50", className)}
    >
      <div
        data-slot="slider-track"
        className="pointer-events-none overflow-hidden rounded-full border border-white/5 shadow-inner"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "50%",
          height: "10px",
          transform: "translateY(-50%)",
          background: "linear-gradient(90deg, #2b2b34 0%, #1a1a22 100%)",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.45)",
          zIndex: 0,
        }}
      >
        <div
          data-slot="slider-range"
          className="rounded-full"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${trackPercent}%`,
            maxWidth: "100%",
            background: "linear-gradient(90deg, #4f74ff 0%, #6a63ff 58%, #7c4dff 100%)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
            willChange: "width",
          }}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={internalValue}
        onPointerDown={() => {
          isDraggingRef.current = true;
        }}
        onInput={(e) => {
          updateLiveValue(Number((e.target as HTMLInputElement).value));
        }}
        onChange={(e) => {
          updateLiveValue(Number((e.target as HTMLInputElement).value));
        }}
        onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onMouseUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        className="relative z-10 h-[18px] w-full appearance-none bg-transparent cursor-pointer focus:outline-none disabled:cursor-not-allowed [&::-webkit-slider-runnable-track]:h-[10px] [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-runnable-track]:border-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:h-[18px] [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#f4f7ff] [&::-webkit-slider-thumb]:bg-[#0b0f18] [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(124,77,255,0.45),0_1px_4px_rgba(0,0,0,0.45)] [&::-moz-range-track]:h-[10px] [&::-moz-range-track]:bg-transparent [&::-moz-range-track]:border-transparent [&::-moz-range-progress]:h-[10px] [&::-moz-range-progress]:bg-transparent [&::-moz-range-thumb]:h-[18px] [&::-moz-range-thumb]:w-[18px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#f4f7ff] [&::-moz-range-thumb]:bg-[#0b0f18] [&::-moz-range-thumb]:box-border"
        style={{ WebkitTapHighlightColor: "transparent" }}
        {...filterFigmaProps(props as Record<string, any>)}
      />
    </div>
  );
}

export { Slider };
 