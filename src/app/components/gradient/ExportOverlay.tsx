/**
 * components/gradient/ExportOverlay.tsx — Stage 2.7.9 (C)
 *
 * Canvas render-state overlay shown while a VIDEO export is running.
 *
 * WHY: video export is deterministic — renderAtTime() walks exact timesteps and
 * awaits every video seek before drawing, which is the only way to get
 * frame-accurate output (realtime capture drifts). The side effect is that the
 * live canvas visibly stutters through slow-motion playback for the duration of
 * the encode. Professional tools never show that; they show a render state.
 * This is that state.
 *
 * Also blocks pointer events over the canvas: dragging/zooming mid-export would
 * mutate interaction uniforms that the deterministic pass is currently reading.
 *
 * PNG/image exports intentionally do NOT get the overlay — they complete in
 * well under a second and a flash of scrim would read as a glitch.
 */

import { Check, Loader2, X } from 'lucide-react';
import { Button } from '../ui/button';
import { requestExportCancellation, useExportStatus } from '../../state/exportStatus';

const PHASE_LABEL: Record<string, string> = {
  preparing: 'Preparing',
  rendering: 'Rendering frames',
  encoding: 'Encoding video',
  saving: 'Saving file',
  cancelling: 'Cancelling export',
  complete: 'Export complete',
};

export function ExportOverlay() {
  const status = useExportStatus();

  if (!status.active || status.kind !== 'video') return null;

  const hasFrames = status.frame > 0 && status.totalFrames > 0;
  const percent = Math.round(status.percent);

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/80"
      role="status"
      aria-live="polite"
      aria-label={`Export in progress, ${percent} percent complete`}
    >
      <div className="w-[320px] rounded-lg border border-zinc-800 bg-zinc-900/95 px-6 py-5 shadow-2xl">
        <div className="flex items-center gap-2.5">
          {/* STAGE 2.8.3: a spinner on a finished export reads as "still
              working". Swap to a check the moment the phase says complete. */}
          {status.phase === 'complete' ? (
            <Check className="h-4 w-4 text-emerald-400" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-blue-400 motion-reduce:animate-none" />
          )}
          <span className="text-sm font-medium text-zinc-100">
            {PHASE_LABEL[status.phase] ?? 'Rendering'}
          </span>
        </div>

        {/* Frame counter — the number that tells the user the app is working
            through a known, finite amount of work rather than struggling. */}
        <div className="mt-3 flex items-baseline gap-2">
          {hasFrames ? (
            <>
              <span className="text-2xl font-semibold tabular-nums text-zinc-100">
                {status.frame}
              </span>
              <span className="text-sm tabular-nums text-zinc-500">
                / {status.totalFrames} frames
              </span>
            </>
          ) : (
            <span className="text-sm text-zinc-400">{status.label || 'Working…'}</span>
          )}
        </div>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-[width] duration-150 ease-out ${
              status.phase === 'complete' ? 'bg-emerald-500' : 'bg-blue-500'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
          <span className="tabular-nums">{percent}%</span>
          <span>{status.phase === 'cancelling' ? 'Restoring preview safely…' : 'Preview paused during render'}</span>
        </div>

        {status.canCancel && status.phase !== 'complete' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={requestExportCancellation}
            className="mt-4 w-full border-zinc-700 text-zinc-300 hover:border-red-500/60 hover:bg-red-500/10 hover:text-red-300"
          >
            <X className="mr-2 h-3.5 w-3.5" />
            Cancel Export
          </Button>
        )}
      </div>
    </div>
  );
}
