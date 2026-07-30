export interface ExportFrameTimingSample {
  readonly frameIndex: number;
  readonly requestedTimeSeconds: number;
  readonly renderStartedMs: number;
  readonly renderCompletedMs: number;
  readonly renderDurationMs: number;
  readonly deltaFromPreviousRequestSeconds: number | null;
  readonly monotonic: boolean;
}

export interface ExportFrameTimingSummary {
  readonly frameCount: number;
  readonly totalRenderMs: number;
  readonly averageRenderMs: number;
  readonly slowestRenderMs: number;
  readonly nonMonotonicFrames: number;
  readonly firstTimeSeconds: number | null;
  readonly lastTimeSeconds: number | null;
}

const now = (): number => globalThis.performance?.now?.() ?? Date.now();

/** Phase 7.4B: lightweight timing authority shared by production and lab exports. */
export class ExportFrameTimingDiagnostics {
  private samples: ExportFrameTimingSample[] = [];
  private previousRequestedTime: number | null = null;

  async measure(frameIndex: number, requestedTimeSeconds: number, render: () => Promise<void>): Promise<ExportFrameTimingSample> {
    const started = now();
    await render();
    const completed = now();
    const previous = this.previousRequestedTime;
    const sample: ExportFrameTimingSample = {
      frameIndex,
      requestedTimeSeconds,
      renderStartedMs: started,
      renderCompletedMs: completed,
      renderDurationMs: completed - started,
      deltaFromPreviousRequestSeconds: previous === null ? null : requestedTimeSeconds - previous,
      monotonic: previous === null || requestedTimeSeconds >= previous,
    };
    this.previousRequestedTime = requestedTimeSeconds;
    this.samples.push(sample);
    return sample;
  }

  reset(): void {
    this.samples = [];
    this.previousRequestedTime = null;
  }

  getSamples(): readonly ExportFrameTimingSample[] { return this.samples; }

  summarize(): ExportFrameTimingSummary {
    const totalRenderMs = this.samples.reduce((sum, sample) => sum + sample.renderDurationMs, 0);
    return {
      frameCount: this.samples.length,
      totalRenderMs,
      averageRenderMs: this.samples.length ? totalRenderMs / this.samples.length : 0,
      slowestRenderMs: this.samples.reduce((max, sample) => Math.max(max, sample.renderDurationMs), 0),
      nonMonotonicFrames: this.samples.filter((sample) => !sample.monotonic).length,
      firstTimeSeconds: this.samples[0]?.requestedTimeSeconds ?? null,
      lastTimeSeconds: this.samples.length ? this.samples[this.samples.length - 1].requestedTimeSeconds : null,
    };
  }
}
