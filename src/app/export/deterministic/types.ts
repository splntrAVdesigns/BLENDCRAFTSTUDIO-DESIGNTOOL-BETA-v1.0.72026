/**
 * PHASE 7.7 — Deterministic export types.
 *
 * Intentionally self-contained. The legacy WebCodecs exporter imported its
 * types from ./video-lab, which is retired Mediabunny test scaffolding. Nothing
 * in this folder may depend on video-lab.
 */

export type DeterministicQuality = 'standard' | 'high' | 'ultra';

export type DeterministicCodecLabel = 'VP9' | 'VP8';

export interface DeterministicEncoderSelection {
  readonly codecLabel: DeterministicCodecLabel;
  /** Full WebCodecs codec string actually configured, e.g. vp09.00.31.08. */
  readonly codecString: string;
  /** Matroska CodecID written into the container. */
  readonly codecId: 'V_VP9' | 'V_VP8';
  readonly hardwareAcceleration: HardwareAcceleration;
  readonly bitrate: number;
}

export interface DeterministicExportDiagnostics {
  readonly engine: 'deterministic-webcodecs';
  readonly codecLabel: DeterministicCodecLabel;
  readonly codecString: string;
  readonly hardwareAcceleration: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly bitrate: number;
  /** Frames handed to the encoder. Must equal totalFrames. */
  readonly renderedFrames: number;
  /** Frames the encoder emitted. Must equal totalFrames. */
  readonly encodedFrames: number;
  readonly totalFrames: number;
  /** Authored timeline duration. Exact by construction. */
  readonly timelineDurationMs: number;
  /** Wall-clock cost of the whole export. Not related to the timeline. */
  readonly wallClockMs: number;
  readonly renderMs: number;
  readonly frameCaptureMs: number;
  readonly encodeAndMuxMs: number;
  /** Export throughput as a multiple of realtime. >1 means faster than realtime. */
  readonly realtimeFactor: number;
  readonly maxEncodeQueueSize: number;
  readonly blobBytes: number;
  readonly actualBitsPerSecond: number;
  readonly livenessProbe: DeterministicLivenessProbe;
}

/**
 * Guards against the classic WebGL capture failure where every VideoFrame is
 * identical (or blank) because the canvas backing store was not populated when
 * the frame was constructed.
 */
export interface DeterministicLivenessProbe {
  readonly sampledFrameIndices: readonly number[];
  readonly signatures: readonly string[];
  readonly distinctSignatures: number;
  readonly passed: boolean;
  readonly reason?: string;
}

export interface DeterministicExportResult {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly diagnostics: DeterministicExportDiagnostics;
}

export interface DeterministicProgress {
  readonly phase: 'preparing' | 'encoding' | 'finalizing' | 'certifying';
  readonly frame: number;
  readonly totalFrames: number;
  readonly percent: number;
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Worker protocol
// ---------------------------------------------------------------------------

export interface WorkerInitMessage {
  readonly type: 'init';
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly bitrate: number;
  readonly totalFrames: number;
}

export interface WorkerFrameMessage {
  readonly type: 'frame';
  readonly index: number;
  readonly frame: VideoFrame;
  readonly keyFrame: boolean;
}

export interface WorkerFinishMessage { readonly type: 'finish' }
export interface WorkerCancelMessage { readonly type: 'cancel' }

export type WorkerInbound =
  | WorkerInitMessage
  | WorkerFrameMessage
  | WorkerFinishMessage
  | WorkerCancelMessage;

export interface WorkerReadyMessage {
  readonly type: 'ready';
  readonly selection: DeterministicEncoderSelection;
}
export interface WorkerAcceptedMessage {
  readonly type: 'accepted';
  readonly index: number;
  readonly queueSize: number;
}
export interface WorkerEncodedMessage {
  readonly type: 'encoded';
  readonly encodedFrames: number;
  readonly queueSize: number;
}
export interface WorkerCompleteMessage {
  readonly type: 'complete';
  readonly buffer: ArrayBuffer;
  readonly mimeType: string;
  readonly encodedFrames: number;
  readonly maxQueueSize: number;
  readonly encodeMs: number;
}
export interface WorkerErrorMessage { readonly type: 'error'; readonly message: string }
export interface WorkerCancelledMessage { readonly type: 'cancelled' }

export type WorkerOutbound =
  | WorkerReadyMessage
  | WorkerAcceptedMessage
  | WorkerEncodedMessage
  | WorkerCompleteMessage
  | WorkerErrorMessage
  | WorkerCancelledMessage;
