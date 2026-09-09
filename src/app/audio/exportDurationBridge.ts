/**
 * audio/exportDurationBridge.ts
 *
 * Sprint 2.8: fixes a live/export mismatch in the LFO's `exportLocked` sync
 * mode. It used to assume every export is 5 seconds long — a hardcoded
 * "nominal window" — so the live preview only matched reality when the
 * user's actual configured duration happened to also be 5s. This bridge
 * lets ExportPanel.tsx publish the real value whenever it changes, and
 * lfoEngine.ts reads it directly.
 *
 * Deliberately the simplest possible bridge — no handler registration, no
 * pub/sub, just a module-level number with a getter/setter. lfoEngine.ts
 * reads it once per frame inside updateLFO_frame(), a plain function call
 * with nothing React-shaped about it, so there's nothing here for a
 * listener pattern to buy over a bare variable.
 */

let exportDurationSeconds = 5; // matches ExportPanel's own default (webmDuration)

/** Called by ExportPanel.tsx whenever its duration field changes. */
export function setExportDurationSeconds(seconds: number): void {
  if (Number.isFinite(seconds) && seconds > 0) {
    exportDurationSeconds = seconds;
  }
}

/** Read by lfoEngine.ts's exportLocked sync mode. */
export function getExportDurationSeconds(): number {
  return exportDurationSeconds;
}
