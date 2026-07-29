// Initialize console filtering BEFORE any other imports
// App v1.0.1 - Fixed Label forwardRef
import './init';

import { useRef, useState, useEffect, useCallback } from 'react';
import { DEFAULT_EFFECTS } from './components/controls/EffectsControls';
import { getBlob as getMediaBlob, pruneExcept as pruneMediaBlobs } from './media/mediaBlobStore';
import { capturePosterFromBlob } from './media/mediaTextureManager';
import { getAutoSavedLayerIds } from './hooks/useAutoSave';
import {
  startMemoryWatchdog,
  stopMemoryWatchdog,
  describeMemoryWarning,
} from './utils/memoryWatchdog';
import { toggleAudioReactive } from './audio/audioReactiveState';
import type { Layer, RenderApi } from './types/gradient';
import { Toaster } from 'sonner';
import { useGradientState } from './hooks/useGradientState';
import { useHistory } from './hooks/useHistory';
import { toast } from 'sonner';
import { logger } from './utils/logger';
import { getDeviceType } from './utils/deviceDetection';
import { GradientCanvas } from './components/gradient/GradientCanvas';
import { ExportOverlay } from './components/gradient/ExportOverlay';
import { CanvasGridOverlay } from './components/canvas/CanvasGridOverlay';
import { CanvasGridControls } from './components/canvas/CanvasGridControls';
import { toggleGrid } from './components/canvas/useCanvasGrid';
import { LeftSidebar } from './components/layout/LeftSidebar';
import { RightSidebar } from './components/layout/RightSidebar';
import { AppHeader } from './components/layout/AppHeader';
import { StatusBar } from './components/ui/StatusBar';
import { PerformanceIndicator } from './components/ui/PerformanceIndicator';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { TutorialSlides } from './components/tutorial/TutorialSlides';
import { LandingPage } from './components/landing/LandingPage';
import { MobileBlockPage } from './components/landing/MobileBlockPage';
import { PWAUpdateNotification, OnlineStatusIndicator } from './components/ui/PWANotifications';
import { VersionIndicator } from './components/debug/VersionIndicator';
import { TooltipProvider } from './contexts/TooltipContext';
import { DragProvider, useDrag } from './contexts/DragContext';
import { useTutorial } from './hooks/useTutorial';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { usePanelState } from './hooks/usePanelState';
import { useUnsavedChanges } from './hooks/useUnsavedChanges';
import { useAutoSave } from './hooks/useAutoSave';
import '../styles/theme.css';

// OUTER COMPONENT: Handles device detection, landing page, DragProvider wrapper
export default function App() {
  // Device detection - block phones, allow tablets & desktop
  const [deviceType, setDeviceType] = useState<'phone' | 'tablet' | 'desktop'>('desktop');
  
  useEffect(() => {
    // Check device type on mount and window resize
    const checkDevice = () => {
      setDeviceType(getDeviceType());
    };
    
    checkDevice();
    window.addEventListener('resize', checkDevice);
    
    return () => window.removeEventListener('resize', checkDevice);
  }, []);
  
  // App flow states — FIX: mount canvas after a 500ms delay on load.
  // This gives the landing page WebGL renderer 500ms to establish its context first,
  // then starts the app WebGL init in background while user reads the landing page.
  // By the time user clicks Launch (~3-10s), app canvas is fully initialised.
  const [showLanding, setShowLanding] = useState(true);
  const [appMounted, setAppMounted] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);

  // Pre-mount the app canvas 500ms after load so WebGL initialises in the background
  // while the user is on the landing page. By click time, canvas is ready.
  // GradientCanvas mounts when user clicks Launch (setAppMounted in handleEnterApp).
  // No pre-mount timer — avoids dual WebGL context with landing page animation.

  // Fired by GradientCanvas.onReady after its first rendered frame.
  // Triggers the fade-in so opacity 0→1 starts exactly when the canvas
  // is live — no guesswork timers, no blank-screen flash.
  const handleCanvasReady = useCallback(() => {
    setFadeIn(true);
  }, []);

  const landingFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeInFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (landingFadeTimerRef.current) clearTimeout(landingFadeTimerRef.current);
      if (fadeInFallbackTimerRef.current) clearTimeout(fadeInFallbackTimerRef.current);
    };
  }, []);

  // Landing page flow handler — PATCHED
  // Old: setShowLanding(false) → setTimeout(100ms) → setShowApp(true) + setFadeIn(true)
  //   Problem: GradientCanvas didn't BEGIN initialising until after the 100ms delay,
  //            and the app wrapper had duration-1000 (1 second) CSS fade.
  //            Total blank time: 100ms + WebGL init (~400ms) + 1000ms fade ≈ 1.5–2.5s
  // New: mount <AppContent> immediately at opacity:0; WebGL inits in parallel with
  //      the landing fade-out; fade-in fires from onReady after first frame.
  //      Total blank time: max(landing fade 200ms, WebGL init ~400ms) + 300ms fade ≈ 600ms
  const handleEnterApp = useCallback(() => {
    // Mount GradientCanvas now — user clicked Launch, landing renderer already disposed.
    // No dual WebGL context conflict: landing page kills its renderer in handleLaunchClick
    // before calling onEnter(), so GradientCanvas gets the full GPU context.
    setAppMounted(true);
    if (landingFadeTimerRef.current) clearTimeout(landingFadeTimerRef.current);
    if (fadeInFallbackTimerRef.current) clearTimeout(fadeInFallbackTimerRef.current);
    landingFadeTimerRef.current = setTimeout(() => { setShowLanding(false); }, 200);
    // Safety net: if onReady never fires, reveal app after 1.5s.
    fadeInFallbackTimerRef.current = setTimeout(() => { setFadeIn(true); }, 1500);
  }, []);

  // CRITICAL: Early returns MUST come AFTER all hooks are called
  // Show mobile block page for phones
  if (deviceType === 'phone') {
    return <MobileBlockPage />;
  }

  // ── PATCHED v1.85.1: Pre-mount strategy ──────────────────────────────────
  // Both landing page and app content can coexist in the DOM simultaneously.
  // App is mounted (opacity:0, pointer-events:none) as soon as the user clicks
  // Enter, giving WebGL ~200ms head-start while the landing page fades out.
  // The app becomes fully visible when GradientCanvas fires onReady() after
  // its first rendered frame — not on a guessed timer.
  return (
    <>
      {/* Landing page — rendered on top while showLanding is true */}
      {showLanding && <LandingPage onEnter={handleEnterApp} />}

      {/* App — mounted immediately when appMounted=true, invisible until onReady fires */}
      {appMounted && (
        <div
          className={`fixed inset-0 bg-zinc-950 touch-no-select`}
          style={{
            // FIX: 200ms fade — crisp and professional, not sluggish
            opacity: fadeIn ? 1 : 0,
            transition: 'opacity 0.2s ease-out',
            // Block interaction until canvas is visible
            pointerEvents: fadeIn ? 'auto' : 'none',
          }}
        >
          <DragProvider>
            <TooltipProvider>
              {/* Pass onCanvasReady down so GradientCanvas can signal when first frame is live */}
              <AppContent onCanvasReady={handleCanvasReady} />
            </TooltipProvider>
          </DragProvider>
          <PWAUpdateNotification />
          <OnlineStatusIndicator />
          <VersionIndicator />
        </div>
      )}
    </>
  );
}

// INNER COMPONENT: Main app logic with access to useDrag
function AppContent({ onCanvasReady }: { onCanvasReady?: () => void }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const renderApiRef = useRef<RenderApi | null>(null);

  // 🔥 ACCESS DRAG CONTEXT
  const { isDragging, startDrag, endDrag } = useDrag();

  // Tutorial management
  const tutorial = useTutorial();

  // State management through custom hooks
  const {
    layers,
    setLayers,
    activeLayerId,
    setActiveLayerId,
    activeLayer,
    canvasSettings,
    setCanvasSettings,
    effects,
    setEffects,
    isPlaying,
    setIsPlaying,
    interactionEnabled,
    setInteractionEnabled,
    setInteractionState,
    updateActiveLayer,
    loadPreset,
    resetToDefaults,
  } = useGradientState();


  const {
    leftPanelCollapsed,
    setLeftPanelCollapsed,
    rightPanelCollapsed,
    setRightPanelCollapsed,
  } = usePanelState();

  // History management
  const {
    canUndo,
    canRedo,
    undo,
    redo,
    pushState,
    clearHistory,
    getHistory,
    goToState,
    currentIndex,
  } = useHistory();

  // COMMIT-BASED HISTORY: Push history on discrete user actions only
  // No more root-level watchers, debounces, or JSON serialization overhead
  const commitHistory = useCallback(() => {
    pushState({
      layers,
      canvasSettings,
      effects,
      activeLayerId,
    });
  }, [layers, canvasSettings, effects, activeLayerId, pushState]);

  // Handle undo
  const handleUndo = () => {
    const state = undo();
    if (state) {
      setLayers(state.layers);
      setCanvasSettings(state.canvasSettings);
      setEffects(state.effects);
      setActiveLayerId(state.activeLayerId);
    }
  };

  // Handle redo
  const handleRedo = () => {
    const state = redo();
    if (state) {
      setLayers(state.layers);
      setCanvasSettings(state.canvasSettings);
      setEffects(state.effects);
      setActiveLayerId(state.activeLayerId);
    }
  };

  // Handle go to specific history state
  const handleGoToState = (index: number) => {
    const state = goToState(index);
    if (state) {
      setLayers(state.layers);
      setCanvasSettings(state.canvasSettings);
      setEffects(state.effects);
      setActiveLayerId(state.activeLayerId);
    }
  };

  // STAGE 2.8.0 — rehydration attempt guard, declared BEFORE useAutoSave so
  // the restore callback can reset it. Root cause of the "video disappears
  // when clicking Restore" bug: rehydration marked each layer id as attempted
  // PERMANENTLY for the session. Restore then replaced the layers with the
  // snapshot — SAME ids, no blob (blobs are stripped from saved state by
  // design) — and the rehydration effect skipped them as already-attempted.
  // The blob existed in IndexedDB the whole time; the guard just refused to
  // read it back a second time.
  const rehydratedIdsRef = useRef<Set<string>>(new Set());

  // Auto-save functionality
  const autoSave = useAutoSave(
    layers,
    canvasSettings,
    (state) => {
      // Restore callback — set state; blob rehydration is handled uniformly by
      // the effect below (covers this path AND the normal initial-mount load).
      // STAGE 2.8.0: restore replaces the layer set, so every id becomes a
      // fresh rehydration candidate again. Clearing BEFORE setLayers means the
      // effect run triggered by this state change sees an empty guard.
      rehydratedIdsRef.current.clear();
      setLayers(state.layers);
      setCanvasSettings(state.canvasSettings);
      // Note: effects not included in autosave state
    }
  );

  // STAGE 2.7.7 (fix): rehydrate persisted video blobs UNIFORMLY.
  // Video/large-media Blobs live in IndexedDB (localStorage can't hold them).
  // Whenever a media layer is present with no live blob but a persisted one
  // exists, read it back and re-attach it — the media pipeline then mints a
  // fresh object URL exactly like a live upload. Runs for BOTH the normal
  // initial-mount load (useGradientState localStorage) AND autosave Restore,
  // so video comes back in every reload path. Guarded per layer id so it
  // doesn't loop.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // STAGE 2.8.0: rehydrate ALL media kinds. Images now persist their blob
      // too (2.8.0 upload/persist changes), so the video-only filter here was
      // the last thing keeping restored image layers empty.
      const needing = layers.filter((l) => {
        const m: any = l.media;
        return (
          m?.enabled &&
          !!m.sourceKind &&
          !m.blob &&
          !rehydratedIdsRef.current.has(l.id)
        );
      });
      if (needing.length === 0) return;
      const results = await Promise.all(
        needing.map(async (l) => {
          rehydratedIdsRef.current.add(l.id); // mark attempted (success or not)
          try {
            const blob = await getMediaBlob(l.id);
            if (!blob) return null;
            // STAGE 2.8.0: rebuild the RUNTIME half of the media config so the
            // restored state is shape-identical to a fresh upload:
            //  - src: fresh object URL minted in THIS document (the invariant
            //    that keeps Figma Make iframe swaps from stranding us — never
            //    trust a persisted blob: string, always mint from live bytes).
            //    Images decode from it directly; the video manager still mints
            //    its own from the blob, so this src is belt-and-braces there.
            //  - previewUrl: video posters are runtime-only and stripped on
            //    save; regenerate from the blob so the Media panel and layer
            //    list get their thumbnails back after a reload. Fails soft to
            //    undefined — cosmetic, never blocks rehydration.
            const src = URL.createObjectURL(blob);
            const isVideo = (l.media as any)?.sourceKind === 'video';
            const previewUrl = isVideo
              ? (await capturePosterFromBlob(blob, 256)) ?? undefined
              : undefined;
            return { id: l.id, blob, src, previewUrl };
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      const found = results.filter(Boolean) as {
        id: string; blob: Blob; src: string; previewUrl?: string;
      }[];
      if (found.length === 0) return;
      const byId = new Map(found.map((f) => [f.id, f]));
      setLayers((prev) =>
        prev.map((l) => {
          const hit = byId.get(l.id);
          if (!hit) return l;
          const m: any = l.media;
          return {
            ...l,
            media: {
              ...m,
              blob: hit.blob,
              src: m?.src ?? hit.src,
              previewUrl: m?.previewUrl ?? hit.previewUrl,
              __rehydrated: true,
            },
          };
        })
      );
      // NOTE: pruning is intentionally NOT done here — it would race
      // rehydration and could delete a blob we're about to use. Orphan cleanup
      // happens on a delayed, separate sweep (see the prune effect below).
    })();
    return () => { cancelled = true; };
  }, [layers]);

  // STAGE 2.7.7 (fix): delayed, safe orphan sweep. Runs once, well after mount
  // and any restore has settled, so it can't race rehydration. Reads the LATEST
  // layers (via ref) so restored layers are counted as live. Deletes only blobs
  // whose layer id is not present in the current document.
  const layersLiveRef = useRef(layers);
  layersLiveRef.current = layers;

  // ── STAGE 2.8.4: MEMORY WATCHDOG ──
  // The app has force-refreshed mid-session with no error — the signature of
  // the renderer process being killed, which is nearly always memory. 2.8.2
  // removed the biggest offender (an unbounded encoder queue holding ~460MB of
  // 1080p frames); this is the general guard so pressure is VISIBLE instead of
  // fatal. Chromium-only (performance.memory is non-standard) and JS-heap only
  // — GPU textures aren't counted, so treat it as a floor, not a guarantee.
  // It can't prevent a kill; it can warn while there's still time to export.
  // STAGE 3.0.1a: audio engine + panel are owned by <AudioReactiveMount />,
  // rendered from AppHeader. App.tsx deliberately holds NO audio code — see
  // audio/components/AudioReactiveMount.tsx for why that indirection exists.
  // The only audio reference left here is the keyboard shortcut below.

  useEffect(() => {
    startMemoryWatchdog((sample) => {
      const message = describeMemoryWarning(sample);
      if (sample.pressure === 'critical') {
        toast.warning(message, { duration: 12000 });
      } else {
        toast.info(message, { duration: 8000 });
      }
    });
    return () => stopMemoryWatchdog();
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => {
      // STAGE 2.8.0: union with the PENDING autosave snapshot's layer ids.
      // The restore dialog can still be open when this fires (it shows for
      // 15s); pruning by current-doc ids alone could delete exactly the blobs
      // a subsequent Restore click needs. Snapshot ids count as live until the
      // dialog is resolved (Restore merges them into the doc; Dismiss prunes
      // them explicitly below).
      const live = layersLiveRef.current.map((l) => l.id);
      void pruneMediaBlobs([...new Set([...live, ...getAutoSavedLayerIds()])]);
    }, 8000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show auto-save restore dialog on mount
  useEffect(() => {
    if (autoSave.hasAutoSave && autoSave.autoSaveTimestamp) {
      const timeAgo = Math.round((Date.now() - autoSave.autoSaveTimestamp) / 1000 / 60); // minutes
      const timeText = timeAgo < 1 ? 'just now' : timeAgo === 1 ? '1 minute ago' : `${timeAgo} minutes ago`;
      
      toast.info(
        `Auto-saved work found from ${timeText}. Restore it?`,
        {
          duration: 15000, // Extended to 15s to allow reading
          action: {
            label: 'Restore',
            onClick: () => {
              autoSave.restoreAutoSave();
              toast.success('Session restored! Animations are disabled for stability. You can re-enable them manually.');
            },
          },
          cancel: {
            label: 'Dismiss',
            onClick: () => {
              autoSave.dismissAutoSave();
              // STAGE 2.8.0 (fix): this used to call clearAll(), which wiped
              // EVERY persisted blob — including the ones backing the CURRENT
              // session's layers. Dismissing an old dialog silently destroyed
              // persistence for live work, so the NEXT reload showed
              // "re-upload to restore" on layers that were fine. Prune to the
              // current document instead: snapshot-only blobs go, live ones stay.
              void pruneMediaBlobs(layersLiveRef.current.map((l) => l.id));
            },
          },
        }
      );
    }
    
    // Show corruption warning if autosave data was invalid
    if (autoSave.isCorrupted) {
      toast.error(
        'Previous autosave was corrupted and has been cleared.',
        {
          duration: 8000,
          action: {
            label: 'Clear All & Restart',
            onClick: () => autoSave.clearAndReset(),
          },
        }
      );
    }
  }, [autoSave.hasAutoSave, autoSave.autoSaveTimestamp, autoSave.isCorrupted]);

  // Track unsaved changes (consider changes unsaved if history has more than 1 entry)
  const hasUnsavedChanges = currentIndex > 0;
  useUnsavedChanges(hasUnsavedChanges, {
    enabled: true, // Always enabled in AppContent
    message: 'You have unsaved changes. Are you sure you want to leave?'
  });

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onPlayPause: () => setIsPlaying(!isPlaying),
    onToggleInteraction: () => setInteractionEnabled(!interactionEnabled),
    onToggleLeftPanel: () => setLeftPanelCollapsed(!leftPanelCollapsed),
    onToggleRightPanel: () => setRightPanelCollapsed(!rightPanelCollapsed),
    onReset: () => {
      if (confirm('Reset all settings to defaults? This cannot be undone.')) {
        resetToDefaults();
      }
    },
    onUndo: handleUndo,
    onRedo: handleRedo,
    onToggleGrid: toggleGrid,
    onToggleAudioReactive: toggleAudioReactive,
  });

  // Main app
  // Memoized layer updater — stable reference prevents GradientCanvas dep-chain
  // cascade on every App render. Without useCallback, this is a new function
  // reference on every render, causing downstream useCallback hooks to re-create.
  const handleUpdateLayer = useCallback((layerId: string, updates: Partial<Layer>) => {
    setLayers(prev => prev.map(layer =>
      layer.id === layerId ? { ...layer, ...updates } : layer
    ));
  }, [setLayers]);


  return (
    <div className="dark h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden flex flex-col min-h-[600px]">
      <AppHeader
        isPlaying={isPlaying}
        interactionEnabled={interactionEnabled}
        leftPanelCollapsed={leftPanelCollapsed}
        rightPanelCollapsed={rightPanelCollapsed}
        onPlayPauseToggle={() => setIsPlaying(!isPlaying)}
        onInteractionToggle={setInteractionEnabled}
        onLeftPanelToggle={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
        onRightPanelToggle={() => setRightPanelCollapsed(!rightPanelCollapsed)}
        onOpenTutorial={tutorial.openTutorial}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Controls */}
        {!leftPanelCollapsed && (
          <ErrorBoundary name="Left Sidebar">
            <LeftSidebar
              activeLayer={activeLayer}
              layers={layers}
              canvasSettings={canvasSettings}
              effects={effects}
              onUpdateActiveLayer={updateActiveLayer}
              onCanvasSettingsChange={setCanvasSettings}
              onEffectsChange={setEffects}
              onLoadPreset={loadPreset}
              isPlaying={isPlaying}
              onLayersChange={setLayers}
              onStopAnimation={() => setIsPlaying(false)}
              onStartDrag={startDrag}
              onEndDrag={endDrag}
              onCommitHistory={commitHistory}
            />
          </ErrorBoundary>
        )}

        {/* Center - Canvas */}
        {/* min-w-0 + overflow-hidden: FLEXBOX OVERFLOW FIX. Flex items default to
            min-width:auto, so when the WebGL canvas's intrinsic pixel buffer is
            briefly set to full project resolution (e.g. during a render/export
            pass), that intrinsic size propagates up through non-clipped
            ancestors and forces this row wider than the viewport, pushing
            RightSidebar off-screen. min-w-0 lets `main` shrink to the space
            actually available; overflow-hidden makes it the hard clip boundary
            instead of the browser window. */}
        <main className="flex-1 flex items-center justify-center p-4 bg-zinc-950 relative min-w-0 overflow-hidden">
          {/* STAGE 2.9.1 — DOTTED BACKDROP GRID. First child and z-0, so it is
              the surface the artwork sits on rather than ink drawn over it. */}
          <CanvasGridOverlay
            canvasWidth={canvasSettings.width}
            canvasHeight={canvasSettings.height}
            getCanvas={() => renderApiRef.current?.getCanvas?.() ?? null}
          />

          <ErrorBoundary name="Gradient Canvas">
            {/* STAGE 2.9.1: z-10 lifts the artwork above the dotted backdrop
                grid (which sits at z-0). Absolutely-positioned elements paint
                above static ones regardless of DOM order, so the canvas needs
                an explicit layer of its own — without it the grid would draw
                over the composition again. */}
            <div ref={canvasRef} className="relative z-10 w-full h-full min-w-0 overflow-hidden">
              <GradientCanvas
                layers={layers}
                canvasSettings={canvasSettings}
                effects={effects}
                isPlaying={isPlaying}
                interactionEnabled={interactionEnabled}
                onInteraction={(state) => {
                  // FIX (perf): Gate interactionState React updates to state TRANSITIONS only.
                  // The indicator label has two states: dragging (shows parameter) and idle.
                  // Previously setInteractionState fired at 60fps during drag, re-rendering
                  // App on every frame for a label that only changes on drag start/end.
                  // Now we only update when the meaningful values actually change.
                  setInteractionState(prev => {
                    const wasInteracting = (prev?.intensity ?? 0) > 0;
                    const isInteracting  = state.intensity > 0;
                    const paramChanged   = prev?.currentParameter !== state.currentParameter;
                    if (wasInteracting === isInteracting && !paramChanged) return prev;
                    return state;
                  });
                }}
                activeLayerId={activeLayerId}
                renderApiRef={renderApiRef}
                onReady={onCanvasReady}
                onUpdateLayer={handleUpdateLayer}
              />
            </div>
          </ErrorBoundary>

          {/* STAGE 2.7.9 (C): canvas render-state overlay. Self-gating — it
              returns null unless a VIDEO export is in flight — so it costs one
              store read when idle. Sits inside <main> so it covers exactly the
              canvas area, not the sidebars. */}
          <ExportOverlay />

          {/* STAGE 2.9.1 — CANVAS GRID CONTROLS. The floating slider bar stays
              ABOVE everything (z-30); only the dotted grid itself moved behind
              the artwork. The grid is DOM/SVG, never WebGL: no GPU cost, no
              shader risk, and it structurally cannot leak into an export
              because exports read the framebuffer and the grid isn't in it.
              Self-gates to null when the grid is off. */}
          <CanvasGridControls
            canvasWidth={canvasSettings.width}
            canvasHeight={canvasSettings.height}
          />

          {/* STAGE 3.0.6: removed the bottom-centre "Interactive Mode" label.
              The top-left Interactive Mode panel already carries this info, so
              the duplicate was redundant and cluttered the canvas bottom edge
              (now the audio panel's space). */}
        </main>

        {/* Right Sidebar - Layers & Export */}
        {!rightPanelCollapsed && (
          <ErrorBoundary name="Right Sidebar">
            <RightSidebar
              layers={layers}
              activeLayerId={activeLayerId}
              effects={effects}
              /* STAGE 2.8.5: applying a loaded session. Clearing the
                 rehydration guard first is the same discipline as the Restore
                 path — a loaded session brings layer ids that may already be
                 marked "attempted", and without the reset their blobs would be
                 skipped and the media would silently vanish (the exact 2.8.0
                 bug, in a new entry point). */
              onLoadSession={(nextLayers, nextCanvas, nextEffects, nextActiveId) => {
                rehydratedIdsRef.current.clear();
                setLayers(nextLayers);
                setCanvasSettings(nextCanvas);
                setEffects(nextEffects);
                setActiveLayerId(nextActiveId ?? nextLayers[0]?.id ?? '');

                // ── STAGE 2.8.6: REGENERATE POSTERS FOR LOADED SESSIONS ──
                // Reported: after loading a slot or importing a .blendcraft,
                // the Media Upload panel showed a generic film icon instead of
                // the video's own thumbnail.
                //
                // CAUSE: `previewUrl` is runtime-only and stripped on save (as
                // it must be — it's a document-scoped data URL). The autosave
                // path regenerates it in the rehydration effect, but that
                // effect only fires for layers with NO blob. Sessions arrive
                // with blobs already attached, so they skip it entirely and
                // never get a poster. The blob was always there; nothing asked
                // it for a frame.
                //
                // Async and fully best-effort: a thumbnail is cosmetic and must
                // never block or break a session load. Mints its own URL for
                // the same reason rehydration does — a persisted blob: string
                // is dead after a document swap.
                void (async () => {
                  const updates = new Map<string, { previewUrl?: string; src: string }>();
                  await Promise.all(nextLayers.map(async (layer) => {
                    const media: any = (layer as any).media;
                    if (!media?.enabled || !(media.blob instanceof Blob)) return;
                    if (media.previewUrl && media.src) return;
                    try {
                      const src = media.src ?? URL.createObjectURL(media.blob);
                      const previewUrl = media.previewUrl ?? (
                        media.sourceKind === 'video'
                          ? (await capturePosterFromBlob(media.blob, 256)) ?? undefined
                          : src
                      );
                      updates.set(layer.id, { previewUrl, src });
                    } catch { /* cosmetic — skip this layer */ }
                  }));
                  if (updates.size === 0) return;
                  setLayers((prev) => prev.map((l) => {
                    const hit = updates.get(l.id);
                    if (!hit) return l;
                    const m: any = l.media;
                    return { ...l, media: { ...m, src: m?.src ?? hit.src, previewUrl: m?.previewUrl ?? hit.previewUrl } };
                  }));
                })();
              }}
              activeLayer={activeLayer}
              canvasSettings={canvasSettings}
              onCanvasSettingsChange={setCanvasSettings}
              onLayersChange={setLayers}
              onResetEffectsForNewMedia={() => setEffects(DEFAULT_EFFECTS)}
              onActiveLayerChange={setActiveLayerId}
              onUpdateActiveLayer={updateActiveLayer}
              canvasRef={canvasRef}
              renderApiRef={renderApiRef}
              history={getHistory()}
              currentHistoryIndex={currentIndex}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onGoToHistoryState={handleGoToState}
              onClearHistory={clearHistory}
              onCommitHistory={commitHistory}
              isPlaying={isPlaying}
              onPlayToggle={() => setIsPlaying(!isPlaying)}
              onStartDrag={startDrag}
              onEndDrag={endDrag}
            />
          </ErrorBoundary>
        )}
      </div>

      {import.meta.env?.DEV && (
        <PerformanceIndicator
          layerCount={layers.length}
          historyLength={getHistory().length}
          canvasWidth={canvasSettings.width}
          canvasHeight={canvasSettings.height}
        />
      )}
      <StatusBar 
        layers={layers}
        canvasSettings={canvasSettings}
        activeLayerId={activeLayerId}
      />
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 8000,
          style: { userSelect: 'none' },
        }}
        closeButton
      />

      {/* Tutorial Slides Overlay */}
      {tutorial.showTutorial && (
        <TutorialSlides
          onComplete={tutorial.completeTutorial}
          onSkip={tutorial.skipTutorial}
        />
      )}
    </div>
  );
}  