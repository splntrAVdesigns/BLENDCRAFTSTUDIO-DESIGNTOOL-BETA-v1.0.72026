/**
 * audio/audioTransport.ts — Stage 3.0.2
 *
 * Keeps audio playback and the app's master transport in step.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * Audio-reactive output is only meaningful when the canvas is also running:
 * the RAF loop only writes the animated uniforms while the app is playing, so
 * audio playing against a paused canvas produces a correct signal driving
 * nothing. Worse, for video media layers the two clocks would drift — the
 * whole point of the feature is that they don't.
 *
 * So: pressing play in the audio panel starts the master transport too, and
 * pausing the master transport pauses audio. One shared notion of "running".
 *
 * ── WHY A BRIDGE RATHER THAN PROPS THROUGH APP ───────────────────────────
 * The transport lives in App state, and the audio module deliberately holds no
 * App.tsx code (see AudioReactiveMount). AppHeader already receives the
 * transport props, and AudioReactiveMount renders from AppHeader — so the
 * handler is handed down one level rather than threaded through the app.
 */

type PlayRequestHandler = () => void;

let requestPlayHandler: PlayRequestHandler | null = null;

/** Registered by AudioReactiveMount from AppHeader's transport props. */
export function setTransportPlayHandler(handler: PlayRequestHandler | null): void {
  requestPlayHandler = handler;
}

/**
 * Ask the app to enter the playing state. No-ops when already playing — the
 * caller passes current state so this can't toggle playback off by accident,
 * which would be the obvious bug in a naive "just call the toggle" version.
 */
export function requestMasterPlay(isCurrentlyPlaying: boolean): void {
  if (isCurrentlyPlaying) return;
  requestPlayHandler?.();
}

/**
 * STAGE 3.0.3 — the missing return direction.
 *
 * Play synced one way (audio play → canvas play) but stop/pause did not, so
 * stopping the track left the canvas running and the two drifted apart — which
 * defeats the point of syncing them at all. Same guard as above: the caller
 * passes current state, so this can only ever pause, never toggle back on.
 */
export function requestMasterPause(isCurrentlyPlaying: boolean): void {
  if (!isCurrentlyPlaying) return;
  requestPlayHandler?.();
}
