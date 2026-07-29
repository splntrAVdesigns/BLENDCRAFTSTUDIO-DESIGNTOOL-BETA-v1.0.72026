import type { FrameCertificateSample, FrameCertificationReport } from './types';

function sampleCanvas(canvas: HTMLCanvasElement): { hash: number; meanLuma: number } {
  const sample = document.createElement('canvas');
  sample.width = 32;
  sample.height = 18;
  const ctx = sample.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error('Frame certification canvas is unavailable.');
  ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
  const pixels = ctx.getImageData(0, 0, sample.width, sample.height).data;
  let hash = 2166136261;
  let luma = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    hash ^= pixels[i]; hash = Math.imul(hash, 16777619);
    hash ^= pixels[i + 1]; hash = Math.imul(hash, 16777619);
    hash ^= pixels[i + 2]; hash = Math.imul(hash, 16777619);
    luma += pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
  }
  return { hash: hash >>> 0, meanLuma: luma / (pixels.length / 4) };
}

export async function certifyAnimationFrames(options: {
  canvas: HTMLCanvasElement;
  totalFrames: number;
  fps: number;
  renderFrameAtTime: (timeSeconds: number) => Promise<void>;
  signal?: AbortSignal;
}): Promise<FrameCertificationReport> {
  const checkpoints = [...new Set([0, Math.floor(options.totalFrames * 0.25), Math.floor(options.totalFrames * 0.5), Math.floor(options.totalFrames * 0.75), options.totalFrames - 1])]
    .filter((frame) => frame >= 0 && frame < options.totalFrames);
  const samples: FrameCertificateSample[] = [];

  for (const frameIndex of checkpoints) {
    if (options.signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
    const timeSeconds = frameIndex / options.fps;
    await options.renderFrameAtTime(timeSeconds);
    const measured = sampleCanvas(options.canvas);
    const previous = samples.at(-1);
    samples.push({ frameIndex, timeSeconds, ...measured, changedFromPrevious: !previous || previous.hash !== measured.hash });
  }

  const uniqueHashes = new Set(samples.map((sample) => sample.hash)).size;
  const blank = samples.every((sample) => sample.meanLuma < 0.5);
  if (blank) return { passed: false, samples, uniqueHashes, reason: 'Certification failed: sampled frames are blank.' };
  if (samples.length > 1 && uniqueHashes < 2) return { passed: false, samples, uniqueHashes, reason: 'Certification failed: animation checkpoints are visually identical.' };
  return { passed: true, samples, uniqueHashes };
}
