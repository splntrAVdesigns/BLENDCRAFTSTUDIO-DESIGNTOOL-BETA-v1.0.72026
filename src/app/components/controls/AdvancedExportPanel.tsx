import React, { useRef } from 'react';
import { ExportPanel } from './ExportPanel';
import { HistoryTimeline } from './HistoryTimeline';
import type { Layer, CanvasSettings, RenderApi } from '../../types/gradient';
import type { HistoryState } from '../../hooks/useHistory';
import type { EffectsConfig } from '../../types/gradient';
import { SessionSlotsPanel } from '../../session/components/SessionSlotsPanel';

interface AdvancedExportPanelProps {
  layers: Layer[];
  canvasSettings: CanvasSettings;
  canvasRef: React.RefObject<HTMLDivElement>;
  renderApiRef?: React.MutableRefObject<RenderApi | null>;
  
  // History props
  history: HistoryState[];
  currentHistoryIndex: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onGoToHistoryState: (index: number) => void;
  onClearHistory: () => void;
  /** Pre-existing prop passed by RightSidebar but never declared here. */
  onCommitHistory?: () => void;

  // STAGE 2.8.5 — session slots (rendered below history, per placement spec).
  // Optional so the panel still renders if a caller hasn't wired them yet.
  effects?: EffectsConfig;
  activeLayerId?: string | null;
  onLoadSession?: (
    layers: Layer[],
    canvasSettings: CanvasSettings,
    effects: EffectsConfig,
    activeLayerId: string | null,
  ) => void;
}

export function AdvancedExportPanel({
  layers,
  canvasSettings,
  canvasRef,
  renderApiRef,
  history,
  currentHistoryIndex,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onGoToHistoryState,
  onClearHistory,
  effects,
  activeLayerId,
  onLoadSession,
}: AdvancedExportPanelProps) {
  return (
    <div className="space-y-6 pb-4">
      {/* Export Panel */}
      <ExportPanel
        layers={layers}
        canvasSettings={canvasSettings}
        canvasRef={canvasRef}
        renderApiRef={renderApiRef}
      />

      {/* Divider */}
      <div className="border-t border-zinc-800" />

      {/* History Timeline */}
      <HistoryTimeline
        history={history}
        currentIndex={currentHistoryIndex}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
        onGoToState={onGoToHistoryState}
        onClearHistory={onClearHistory}
      />

      {/* STAGE 2.8.5 — SAVED SESSIONS, below the history section.
          Rendered only when the caller wires the session props, so this panel
          degrades cleanly rather than half-working. Slots are entirely separate
          from autosave: manual, named, and destroyed only by the user. */}
      {effects && onLoadSession && (
        <>
          <div className="border-t border-zinc-800" />
          <SessionSlotsPanel
            layers={layers}
            canvasSettings={canvasSettings}
            effects={effects}
            activeLayerId={activeLayerId ?? null}
            onLoadSession={onLoadSession}
            getThumbnail={() => {
              // Reuse the live canvas for the slot poster. Small and cheap;
              // null before first render, which the panel handles.
              try {
                const canvas = renderApiRef?.current?.getCanvas?.() ?? null;
                if (!canvas) return null;
                const scaled = document.createElement('canvas');
                scaled.width = 160;
                scaled.height = Math.max(1, Math.round((canvas.height / canvas.width) * 160));
                const ctx = scaled.getContext('2d');
                if (!ctx) return null;
                ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
                return scaled.toDataURL('image/jpeg', 0.7);
              } catch {
                return null;
              }
            }}
          />
        </>
      )}
    </div>
  );
}