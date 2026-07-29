import type { VideoLabEnvironment, VideoLabEnvironmentReport } from './types';

function detectEnvironment(hostname: string): VideoLabEnvironment {
  const normalized = hostname.toLowerCase();
  if (normalized.endsWith('.vercel.app')) return 'vercel';
  if (normalized.includes('figma') || normalized.includes('make')) return 'figma';
  if (normalized === 'localhost' || normalized === '127.0.0.1') return 'local';
  return 'unknown';
}

export function captureVideoLabEnvironment(): VideoLabEnvironmentReport {
  const location = globalThis.location;
  const navigatorValue = globalThis.navigator as Navigator & { deviceMemory?: number };
  return {
    environment: detectEnvironment(location?.hostname ?? ''),
    href: location?.href ?? '',
    userAgent: navigatorValue?.userAgent ?? 'unknown',
    hardwareConcurrency: Number.isFinite(navigatorValue?.hardwareConcurrency)
      ? navigatorValue.hardwareConcurrency
      : null,
    deviceMemoryGb: Number.isFinite(navigatorValue?.deviceMemory)
      ? navigatorValue.deviceMemory ?? null
      : null,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    offscreenCanvas: typeof globalThis.OffscreenCanvas !== 'undefined',
    videoEncoder: typeof globalThis.VideoEncoder !== 'undefined',
    secureContext: globalThis.isSecureContext === true,
    capturedAt: new Date().toISOString(),
  };
}
