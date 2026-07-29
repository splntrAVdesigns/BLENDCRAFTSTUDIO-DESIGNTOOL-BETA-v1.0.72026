/**
 * audio/audioLayerRoster.ts — Stage 3.0.2a
 *
 * A tiny published list of the current layers (id + name), so the audio panel
 * can offer a per-layer routing target.
 *
 * ── WHY A STORE RATHER THAN PROPS ────────────────────────────────────────
 * The panel is portaled from AppHeader, and AppHeader has no access to the
 * layer list. Threading `layers` down through App → AppHeader → Mount → Panel
 * purely so a dropdown can show three names would mean editing App.tsx and
 * widening the header's props for something neither of them cares about — and
 * the whole point of AudioReactiveMount is that the audio feature wires itself
 * in rather than scattering edits through the app.
 *
 * GradientCanvas already holds `layers` and already imports from this module,
 * so it publishes the roster in an effect keyed on layer identity. One line at
 * a component that already has the data.
 *
 * NOT on the hot path: this updates when layers change (add/remove/rename),
 * not per frame, so an ordinary allocating store is fine here. The per-frame
 * side of layer targeting lives in audioMapping's resolver, which stays
 * zero-allocation.
 */

import { useSyncExternalStore } from 'react';

export interface RosterEntry {
  id: string;
  name: string;
}

let roster: RosterEntry[] = [];
const listeners = new Set<() => void>();

/**
 * Publish the current layers. Called from GradientCanvas.
 *
 * Compares before publishing so an unchanged roster doesn't wake every
 * subscriber — layer effects can re-run for reasons that don't change identity
 * or naming, and the dropdown has no reason to re-render for those.
 */
export function publishLayerRoster(next: RosterEntry[]): void {
  if (
    next.length === roster.length &&
    next.every((n, i) => n.id === roster[i].id && n.name === roster[i].name)
  ) {
    return;
  }
  roster = next;
  listeners.forEach((l) => { try { l(); } catch { /* isolate subscribers */ } });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const getSnapshot = () => roster;

export function useLayerRoster(): RosterEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Non-hook read, for validating a mapping's stored layerId. */
export function getLayerRoster(): RosterEntry[] {
  return roster;
}
