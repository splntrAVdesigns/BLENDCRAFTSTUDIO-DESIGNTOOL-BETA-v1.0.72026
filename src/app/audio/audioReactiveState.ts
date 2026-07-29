/**
 * audio/audioReactiveState.ts — Stage 3.0.1
 *
 * The enabled/disabled state of the audio-reactive feature, plus (for now) the
 * one hardcoded proof mapping.
 *
 * SCOPE: 3.0.1 proves the PIPE — file → analysis → bus → uniform → visible
 * motion — with a single fixed mapping (Low band → animation intensity). The
 * user-configurable mapping table arrives in 3.0.2; this file deliberately
 * ships only the toggle state and a constant so there's nothing speculative to
 * maintain until the real thing lands.
 *
 * STATE SPLIT (locked in the plan §8):
 *   • "Is the panel open / feature armed" is a GLOBAL VIEW PREFERENCE — same
 *     class as Grid and Tooltips. It lives here, persisted to its own
 *     localStorage key, off by default (confirmed).
 *   • The mapping table itself will be DOCUMENT state (travels with sessions).
 *     Not here — that's 3.0.2, and it goes through the session serializer.
 */

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'blendcraft-audio-reactive-v1';

interface AudioReactiveViewState {
  /** Feature armed + panel visible. Off by default, matching Grid. */
  enabled: boolean;
}

const DEFAULTS: AudioReactiveViewState = {
  enabled: false,
};

function load(): AudioReactiveViewState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return { enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : false };
  } catch {
    return DEFAULTS;
  }
}

let snapshot: AudioReactiveViewState = load();
const listeners = new Set<() => void>();

function publish(next: AudioReactiveViewState): void {
  snapshot = Object.freeze(next);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* private mode */ }
  listeners.forEach((l) => { try { l(); } catch { /* one subscriber must not break others */ } });
  // STAGE 3.0.1a: the toggle lives in AppHeader but the panel mounts from
  // App.tsx. If only one of those files gets applied, the button works and
  // nothing appears — indistinguishable from a broken feature. Logging both
  // ends makes which link is missing immediately visible.
  console.info(
    `[Audio] reactive ${next.enabled ? 'ENABLED' : 'disabled'} · ` +
    `subscribers=${listeners.size} · panelMounted=${panelMounted}`,
  );
}

/**
 * Set by AudioReactivePanel on mount/unmount. Purely diagnostic — nothing
 * branches on it. It exists so `__audioUI.check()` can distinguish "the flag
 * is on but App.tsx never rendered the panel" from "the flag never turned on".
 */
let panelMounted = false;
export function notifyPanelMounted(mounted: boolean): void {
  panelMounted = mounted;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const getSnapshot = () => snapshot;

export function setAudioReactiveEnabled(enabled: boolean): void {
  publish({ ...snapshot, enabled });
}

export function toggleAudioReactive(): void {
  publish({ ...snapshot, enabled: !snapshot.enabled });
}

export function useAudioReactiveEnabled(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).enabled;
}

/** Non-hook read for the render loop, which must not subscribe. */
export function isAudioReactiveEnabled(): boolean {
  return snapshot.enabled;
}


/**
 * STAGE 3.0.1a — `window.__audioUI`.
 *
 * Answers one question in one command: which link in the chain is missing?
 * Called once from App.tsx alongside the engine install.
 */
export function installAudioUIDiagnostic(): void {
  try {
    (window as any).__audioUI = {
      check() {
        const report = {
          enabled: snapshot.enabled,
          subscribers: listeners.size,
          panelMounted,
          appTsxApplied: true, // this only runs if App.tsx called it
        };
        console.info('[Audio UI]', report);
        if (report.enabled && !report.panelMounted) {
          console.warn(
            '[Audio UI] Feature is ON but the panel never mounted. The mount ' +
            'line lives in App.tsx: {audioReactiveEnabled && <AudioReactivePanel />}. ' +
            'If that line is missing, App.tsx did not get the 3.0.1 patch.',
          );
        }
        return report;
      },
      enable: () => setAudioReactiveEnabled(true),
      disable: () => setAudioReactiveEnabled(false),
    };
    console.info('[Audio] UI diagnostic installed — run __audioUI.check()');
  } catch {
    /* diagnostics must never break the app */
  }
}
