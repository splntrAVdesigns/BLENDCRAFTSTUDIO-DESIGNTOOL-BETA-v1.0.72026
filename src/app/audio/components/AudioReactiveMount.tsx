/**
 * audio/components/AudioReactiveMount.tsx — Stage 3.0.1a
 *
 * Makes the audio-reactive feature SELF-MOUNTING.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * 3.0.1 shipped correctly but did not appear: the header toggle rendered
 * (AppHeader applied) while the panel never mounted, because both the engine
 * install and the panel mount lived as small edits inside App.tsx — a large,
 * frequently-regenerated file. Two failure modes produce exactly that symptom:
 *
 *   1. App.tsx's edits don't land, so nothing that lives there runs, or
 *   2. `audioReactiveState` gets bundled into two chunks, so AppHeader and App
 *      read DIFFERENT store singletons — the header's toggle flips its copy
 *      (button lights up) while App's copy stays false (panel never mounts).
 *
 * Both are fixed by the same move: mount everything from ONE component,
 * rendered by a host that is already proven to render, so there is a single
 * store instance and a single mount point. This also matches the stated
 * architecture goal — the audio module wires itself into the app instead of
 * scattering edits through it.
 *
 * App.tsx now needs ZERO audio code. If it never applies, the feature still
 * works end to end.
 *
 * ── PORTAL TARGET ────────────────────────────────────────────────────────
 * The panel is a canvas-area overlay, so it must live inside the same
 * positioned element the grid controls use, NOT in the header's own subtree.
 * The host is resolved from the live WebGL canvas (`canvas.closest('main')`)
 * rather than a bare `querySelector('main')`, so it can only ever land on the
 * element that actually contains the artwork — and it inherits correct
 * positioning when sidebars collapse, with no measurement code.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { installAudioEngine, disposeAudioEngine, pauseAudio, getAudioEngineStatus } from '../audioEngine';
import { setTransportPlayHandler, requestMasterPause } from '../audioTransport';
import { setGatedEffectHandler, type GatedToggleField } from '../audioEffectsGateSync';
import { useAudioReactiveEnabled, installAudioUIDiagnostic } from '../audioReactiveState';
import { AudioReactivePanel } from './AudioReactivePanel';

/** Find the canvas-area element the panel should render into. */
function resolveHost(): HTMLElement | null {
  const canvas = document.querySelector('canvas');
  const viaCanvas = canvas?.closest('main');
  if (viaCanvas instanceof HTMLElement) return viaCanvas;
  const fallback = document.querySelector('main');
  return fallback instanceof HTMLElement ? fallback : document.body;
}

interface AudioReactiveMountProps {
  /** Master transport state + control, handed down from AppHeader. */
  isPlaying: boolean;
  onPlayPauseToggle: () => void;
  /** Option A: routing-driven effect toggle sync, handed down from AppHeader. */
  onSetGatedEffect: (field: GatedToggleField, enabled: boolean) => void;
}

export function AudioReactiveMount({ isPlaying, onPlayPauseToggle, onSetGatedEffect }: AudioReactiveMountProps) {
  const enabled = useAudioReactiveEnabled();
  const [host, setHost] = useState<HTMLElement | null>(null);

  // Engine install lives here now, not in App.tsx. Still lazy about the
  // AudioContext itself — this only registers diagnostics and the console API;
  // the context is created on first file load, preserving the user-gesture gate.
  useEffect(() => {
    installAudioEngine();
    installAudioUIDiagnostic();
    return () => disposeAudioEngine();
  }, []);

  // STAGE 3.0.2: hand the master transport to the audio module. Kept in a ref
  // via re-registration rather than captured once, so the handler never goes
  // stale as App's play state changes.
  useEffect(() => {
    setTransportPlayHandler(onPlayPauseToggle);
    return () => setTransportPlayHandler(null);
  }, [onPlayPauseToggle]);

  // Option A: same re-registration pattern as the transport handler above,
  // for the same reason — onSetGatedEffect closes over App's current
  // effects state, so it must be re-registered whenever App re-renders
  // with new effects, not captured once.
  useEffect(() => {
    setGatedEffectHandler(onSetGatedEffect);
    return () => setGatedEffectHandler(null);
  }, [onSetGatedEffect]);

  // Pausing the canvas pauses audio, so the two clocks can't drift apart.
  // Only acts on a real transition into paused, so it can't fight the user's
  // own audio pause.
  useEffect(() => {
    if (!isPlaying && getAudioEngineStatus() === 'playing') pauseAudio();
  }, [isPlaying]);

  // STAGE 3.0.3: and the return direction — audio stopping/pausing pauses the
  // canvas. Previously only play synced, so stopping the track left the canvas
  // running and the two drifted, which defeats the purpose of syncing at all.
  //
  // Polled on a light interval rather than pushed from the engine, because the
  // engine also stops itself on natural end-of-track (source.onended), and a
  // status poll catches every route into "no longer playing" with one code
  // path instead of hooking each of them separately.
  // Kept in a ref so the interval below always sees current transport state
  // without being torn down and rebuilt on every play/pause.
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const wasAudioPlayingRef = useRef(false);
  useEffect(() => {
    const id = window.setInterval(() => {
      const nowPlaying = getAudioEngineStatus() === 'playing';
      if (wasAudioPlayingRef.current && !nowPlaying) {
        requestMasterPause(isPlayingRef.current);
      }
      wasAudioPlayingRef.current = nowPlaying;
    }, 120);
    return () => window.clearInterval(id);
  }, []);

  // Resolve the portal host once the canvas exists. The canvas mounts inside
  // GradientCanvas's own effects, which may run after this component's first
  // paint, so retry briefly rather than giving up on a single miss.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let attempts = 0;

    const attempt = () => {
      if (cancelled) return;
      const found = resolveHost();
      if (found) {
        setHost(found);
        return;
      }
      if (attempts++ < 60) requestAnimationFrame(attempt);
    };
    attempt();

    return () => { cancelled = true; };
  }, [enabled]);

  // Diagnostic, matching the __audioBus / __mediaDebug convention. This is what
  // makes a partial install visible instead of silent.
  useEffect(() => {
    try {
      (window as any).__audioReactive = {
        get enabled() { return enabled; },
        get panelMounted() { return enabled && host !== null; },
        get host() { return host?.tagName ?? null; },
      };
    } catch { /* diagnostics must never break the app */ }
  }, [enabled, host]);

  if (!enabled || !host) return null;
  return createPortal(<AudioReactivePanel isPlaying={isPlaying} />, host);
}
