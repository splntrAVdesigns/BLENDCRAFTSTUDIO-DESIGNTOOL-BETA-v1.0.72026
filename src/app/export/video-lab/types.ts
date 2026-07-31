export type VideoLabCodec = 'avc1.42001f' | 'vp09.00.10.08' | 'vp8';
export type VideoLabContainer = 'mp4' | 'webm';
export type VideoLabExecutionMode = 'main-thread' | 'worker';
export type VideoLabEnvironment = 'figma' | 'vercel' | 'local' | 'unknown';

export interface VideoLabCapability {
  codec: VideoLabCodec;
  container: VideoLabContainer;
  supported: boolean;
  config?: VideoEncoderConfig;
  reason?: string;
}

export interface FrameCertificateSample {
  frameIndex: number;
  timeSeconds: number;
  hash: number;
  meanLuma: number;
  changedFromPrevious: boolean;
}

export interface FrameCertificationReport {
  passed: boolean;
  samples: FrameCertificateSample[];
  uniqueHashes: number;
  reason?: string;
}

export interface VideoLabEnvironmentReport {
  environment: VideoLabEnvironment;
  href: string;
  userAgent: string;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  crossOriginIsolated: boolean;
  offscreenCanvas: boolean;
  videoEncoder: boolean;
  secureContext: boolean;
  capturedAt: string;
}

export interface VideoLabStageTimings {
  certificationMs: number;
  setupMs: number;
  renderMs: number;
  frameTransferMs: number;
  stagingDrawMs: number;
  encodeSubmitMs: number;
  peakPendingFrames: number;
  longestFrameMs?: number;
  flushMs: number;
  muxFinalizeMs: number;
  blobMs: number;
  totalMs: number;
}

export interface VideoLabBenchmarkResult {
  phase: '7.3F.1' | '7.4F';
  engine: 'mediabunny';
  mode: VideoLabExecutionMode;
  codec: VideoLabCodec;
  container: VideoLabContainer;
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSeconds: number;
  timings: VideoLabStageTimings;
  outputBytes: number;
  mimeType: string;
  environment: VideoLabEnvironmentReport;
  certification: FrameCertificationReport;
  startedAt: string;
  completedAt: string;
}

export interface VideoLabProgress {
  stage: 'certifying' | 'preparing' | 'rendering' | 'staging' | 'encoding' | 'finalizing' | 'complete';
  frame: number;
  totalFrames: number;
  percent: number;
  message: string;
}

export interface RunMediabunnyMainThreadOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  codec: VideoLabCodec;
  container: VideoLabContainer;
  bitrate?: number;
  certifyFrames?: boolean;
  renderFrameAtTime: (timeSeconds: number) => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (progress: VideoLabProgress) => void;
}

export interface VideoLabArtifact {
  blob: Blob;
  suggestedFilename: string;
  benchmark: VideoLabBenchmarkResult;
}
