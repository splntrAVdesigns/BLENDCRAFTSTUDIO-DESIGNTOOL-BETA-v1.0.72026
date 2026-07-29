/**
 * Phase 7.3F.1 dependency boundary.
 *
 * Keep this dynamic so the production exporter never imports Mediabunny. Vite
 * resolves and splits this chunk only after `mediabunny` is installed. The
 * deliberately indirect import keeps the current Figma build loadable before
 * installation, while the lab gives a clear activation error.
 */
export async function loadMediabunny(): Promise<Record<string, unknown>> {
  const packageName = 'mediabunny';
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<Record<string, unknown>>;
    return await dynamicImport(packageName);
  } catch (error) {
    throw new Error(
      'Mediabunny Video Export Lab is not installed or could not load. '
      + 'Run `npm install mediabunny@1.51.0`, commit package.json/package-lock.json, '
      + `then rebuild. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
