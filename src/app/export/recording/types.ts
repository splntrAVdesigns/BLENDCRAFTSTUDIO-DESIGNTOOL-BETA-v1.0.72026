export type RecordingSessionState =
  | 'idle'
  | 'preparing'
  | 'recording'
  | 'stopping'
  | 'finalizing'
  | 'restoring'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type RecordingQuality = 'standard' | 'high' | 'ultra';

export interface RecordingDimensions {
  readonly width: number;
  readonly height: number;
}

export interface RecordingProfile extends RecordingDimensions {
  readonly id: string;
  readonly quality: RecordingQuality;
  readonly fps: number;
  readonly videoBitsPerSecond: number;
  readonly maxDurationMs: number;
  readonly maxEstimatedBytes: number;
  readonly dataTimesliceMs: number;
}

export type RecordingCaptureMode = 'manual-request-frame' | 'automatic-fps';

export interface RecordingCodecSelection {
  readonly mimeType: string;
  readonly codecLabel: 'VP9' | 'VP8' | 'WebM';
}

export interface RecordingRecorderAttempt {
  readonly captureMode: RecordingCaptureMode;
  readonly codec: RecordingCodecSelection;
}

export interface RecordingLivenessDiagnostics {
  readonly passed: boolean;
  readonly attemptCount: number;
  readonly probeDurationMs: number;
  readonly probeBytes: number;
  readonly failures: readonly string[];
}

export interface RecordingQualityCertification {
  readonly passed: boolean;
  readonly actualBitsPerSecond: number;
  readonly targetUtilization: number;
  readonly frameCompletionRatio: number;
  readonly warnings: readonly string[];
}

export interface RecordingCleanupDiagnostics {
  readonly recorderStopped: boolean;
  readonly streamTracksStopped: number;
  readonly recordingCanvasDisposed: boolean;
  readonly compositorDisposed: boolean;
  readonly previewDisposed?: boolean;
  readonly rendererRestored?: boolean;
  readonly cleanupTimedOut?: boolean;
  readonly cleanupDurationMs?: number;
  readonly warnings: readonly string[];
}

export interface RecordingDiagnostics {
  readonly state: RecordingSessionState;
  readonly selectedMimeType?: string;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly fps: number;
  readonly targetBitrate: number;
  readonly actualBitrate?: number;
  readonly codecLabel?: RecordingCodecSelection['codecLabel'];
  readonly codecFallbackIndex?: number;
  readonly captureMode?: RecordingCaptureMode;
  readonly liveness?: RecordingLivenessDiagnostics;
  readonly dataTimesliceMs?: number;
  readonly publishedFrameCount: number;
  readonly chunkCount: number;
  readonly accumulatedBytes: number;
  readonly recorderState?: RecordingState;
  readonly startedAtMs?: number;
  readonly stoppedAtMs?: number;
  readonly finalizationDurationMs?: number;
  readonly cancellationDurationMs?: number;
  readonly frameSource?: 'gpu-readback' | 'canvas';
  readonly sourceWidth?: number;
  readonly sourceHeight?: number;
  readonly exactResolution?: boolean;
  readonly qualityCertification?: RecordingQualityCertification;
  readonly lateFrameCount?: number;
  readonly maxFrameLatenessMs?: number;
  readonly averageFrameLatenessMs?: number;
  readonly estimatedDuplicateCaptures?: number;
  readonly expectedDurationMs?: number;
  readonly measuredRecordingDurationMs?: number;
  readonly durationDriftMs?: number;
  readonly cleanup?: RecordingCleanupDiagnostics;
}

export interface RecordingProgress {
  readonly state: RecordingSessionState;
  readonly publishedFrameCount: number;
  readonly totalFrames: number;
  readonly elapsedMs: number;
  readonly label: string;
}

export interface RecordingFramePublisherResult {
  readonly totalFrames: number;
  readonly publishedFrames: number;
  readonly skippedFrames: number;
  readonly lateFrameCount: number;
  readonly maxFrameLatenessMs: number;
  readonly averageFrameLatenessMs: number;
  readonly estimatedDuplicateCaptures: number;
  readonly elapsedMs: number;
  readonly usedManualRequestFrame: boolean;
}

export interface RecordingSessionResult {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly diagnostics: RecordingDiagnostics;
}

export interface RecordingCanvasHandle {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  dispose(): void;
}
