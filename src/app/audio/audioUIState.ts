/**
 * audio/audioUIState.ts — Stage 3.0.1b
 *
 * ── WHY THIS IS AT THE MODULE ROOT AND NOT IN audio/hooks/ ──
 * It was originally `audio/hooks/useAudioReactiveState.ts`. That directory
 * contained exactly one file, and it did not survive being applied to the
 * project — Vite then failed to resolve the import from two components and the
 * whole app failed to load. `audio/components/` (three files) applied fine, so
 * the practical lesson is that a new subdirectory is a real failure surface in
 * this environment and one holding a single file buys nothing to justify it.
 *
 * Flattened to the module root, which already holds types/bus/engine/analysis.
 * Same code, one less directory that has to exist for the app to boot.
 *
 * A THROTTLED React subscription to the audio bus, for UI only.
 *
 * The bus updates every frame (60Hz). UI meters do not need 60Hz — a bar that
 * refreshes 15×/sec looks smooth to the eye and costs a quarter of the
 * re-renders. This hook is the ONLY bridge from the ref-based bus into React,
 * and it exists specifically so that meters can't accidentally put a 60Hz
 * setState on the hot path. The render loop never uses this — it reads the bus
 * directly (see audioReactiveRender.ts).
 */

import { useEffect, useState } from 'react';
import { readAudioBus } from './audioBus';
import type { AudioEngineStatus } from './types';

export interface AudioUIState {
  active: boolean;
  status: AudioEngineStatus;
  low: number;
  mid: number;
  high: number;
  level: number;
  frameCount: number;
}

const UI_REFRESH_HZ = 15;

export function useAudioUIState(): AudioUIState {
  const [ui, setUi] = useState<AudioUIState>(() => snap());

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const interval = 1000 / UI_REFRESH_HZ;

    const tick = (t: number) => {
      if (t - last >= interval) {
        last = t;
        const next = snap();
        // Only re-render on a meaningful change, so a paused engine costs
        // nothing. Comparing the coarse fields is enough — the meters only
        // show these.
        setUi((prev) =>
          prev.status === next.status &&
          prev.active === next.active &&
          Math.abs(prev.low - next.low) < 0.004 &&
          Math.abs(prev.mid - next.mid) < 0.004 &&
          Math.abs(prev.high - next.high) < 0.004
            ? prev
            : next,
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return ui;
}

function snap(): AudioUIState {
  const b = readAudioBus();
  return {
    active: b.active,
    status: b.status,
    low: b.low,
    mid: b.mid,
    high: b.high,
    level: b.level,
    frameCount: b.frameCount,
  };
}
