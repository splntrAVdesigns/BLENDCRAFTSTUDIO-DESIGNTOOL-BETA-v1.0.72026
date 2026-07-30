/**
 * Phase 7.4D.1 production dependency boundary.
 *
 * IMPORTANT: this import must remain statically visible to Vite/Rollup.
 * Indirect imports created with eval/new Function leave the bare package name
 * in the browser bundle, which causes Vercel deployments to fail at runtime
 * with "Failed to resolve module specifier 'mediabunny'".
 */
import * as mediabunny from 'mediabunny';

export async function loadMediabunny(): Promise<Record<string, unknown>> {
  return mediabunny as unknown as Record<string, unknown>;
}
