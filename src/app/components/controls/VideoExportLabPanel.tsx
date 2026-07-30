import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { AlertTriangle, CheckCircle2, Download, FlaskConical, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { RenderApi } from '../../types/gradient';
import { createAuthoritativeExportFrameSource } from '../../export/AuthoritativeExportFrameSource';
import {
  downloadVideoLabArtifact,
  probeVideoLabCapabilities,
  runMediabunnyMainThread,
  type VideoLabArtifact,
  type VideoLabCapability,
  type VideoLabCodec,
  type VideoLabProgress,
} from '../../export/video-lab';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Progress } from '../ui/progress';
import { SelectWrapper } from '../ui/select-wrapper';

interface VideoExportLabPanelProps {
  renderApiRef?: MutableRefObject<RenderApi | null>;
}

const TEST_WIDTH = 1280;
const TEST_HEIGHT = 720;
const TEST_FPS = 30;
const TEST_DURATION_SECONDS = 5;

const codecLabels: Record<VideoLabCodec, string> = {
  'avc1.42001f': 'MP4 · H.264',
  'vp09.00.10.08': 'WebM · VP9',
  vp8: 'WebM · VP8',
};

function isLabEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const queryEnabled = new URLSearchParams(window.location.search).get('videoLab') === '1';
  const persisted = window.localStorage.getItem('blendcraft.videoLab.enabled') === '1';
  return queryEnabled || persisted;
}

export function VideoExportLabPanel({ renderApiRef }: VideoExportLabPanelProps) {
  const [enabled, setEnabled] = useState(false);
  const [capabilities, setCapabilities] = useState<VideoLabCapability[]>([]);
  const [probing, setProbing] = useState(false);
  const [selectedCodec, setSelectedCodec] = useState<VideoLabCodec>('vp09.00.10.08');
  const [progress, setProgress] = useState<VideoLabProgress | null>(null);
  const [artifact, setArtifact] = useState<VideoLabArtifact | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setEnabled(isLabEnabled());
    return () => abortRef.current?.abort();
  }, []);

  const selectedCapability = useMemo(
    () => capabilities.find((entry) => entry.codec === selectedCodec),
    [capabilities, selectedCodec],
  );

  if (!enabled) return null;

  const probe = async () => {
    setProbing(true);
    setError(null);
    try {
      const result = await probeVideoLabCapabilities(TEST_WIDTH, TEST_HEIGHT, TEST_FPS);
      setCapabilities(result);
      const firstSupported = result.find((entry) => entry.supported);
      if (firstSupported) setSelectedCodec(firstSupported.codec);
    } catch (probeError) {
      setError(probeError instanceof Error ? probeError.message : String(probeError));
    } finally {
      setProbing(false);
    }
  };

  const runProof = async () => {
    const api = renderApiRef?.current;
    if (!api || !api.setExportSize || !api.restoreSize) {
      toast.error('Video Lab requires the deterministic renderer and resize bridge.');
      return;
    }
    let frameSource;
    try {
      frameSource = createAuthoritativeExportFrameSource(api);
    } catch (sourceError) {
      toast.error(sourceError instanceof Error ? sourceError.message : 'Renderer source unavailable.');
      return;
    }
    if (!selectedCapability?.supported) {
      toast.error('Run the codec probe and select a supported codec first.');
      return;
    }

    const abortController = new AbortController();
    abortRef.current = abortController;
    setIsRunning(true);
    setArtifact(null);
    setError(null);
    setProgress({
      stage: 'preparing', frame: 0, totalFrames: TEST_FPS * TEST_DURATION_SECONDS,
      percent: 0, message: 'Preparing isolated proof run…',
    });

    try {
      api.configureExportTimeline?.({
        fps: TEST_FPS,
        totalFrames: TEST_FPS * TEST_DURATION_SECONDS,
        durationMs: TEST_DURATION_SECONDS * 1000,
        loopLockEnabled: false,
      });
      api.pauseAnimation?.({ resetExportPhase: true });
      await api.waitForMaskTextures?.(4000);
      api.setExportSize(TEST_WIDTH, TEST_HEIGHT);
      await api.prepareAudioExport?.();

      const result = await runMediabunnyMainThread({
        canvas: frameSource.canvas,
        width: TEST_WIDTH,
        height: TEST_HEIGHT,
        fps: TEST_FPS,
        durationSeconds: TEST_DURATION_SECONDS,
        codec: selectedCodec,
        container: selectedCodec === 'avc1.42001f' ? 'mp4' : 'webm',
        renderFrameAtTime: (timeSeconds) => frameSource.renderFrame(timeSeconds, true),
        signal: abortController.signal,
        onProgress: setProgress,
      });
      setArtifact(result);
      toast.success('Video Lab proof export passed frame certification and encoded successfully.');
    } catch (runError) {
      if (abortController.signal.aborted) {
        setError('Proof run cancelled.');
      } else {
        const message = runError instanceof Error ? runError.message : String(runError);
        setError(message);
        toast.error(`Video Lab failed: ${message}`);
      }
    } finally {
      abortRef.current = null;
      setIsRunning(false);
      api.finishAudioExport?.();
      if (api.cleanupExportSession) await api.cleanupExportSession();
      else {
        api.clearExportTimeline?.();
        api.restoreSize?.();
        api.resumeAnimation?.();
      }
    }
  };

  const disableLab = () => {
    window.localStorage.removeItem('blendcraft.videoLab.enabled');
    const url = new URL(window.location.href);
    url.searchParams.delete('videoLab');
    window.history.replaceState({}, '', url);
    setEnabled(false);
  };

  return (
    <section className="mt-4 space-y-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3" data-testid="video-export-lab">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-cyan-300">
            <FlaskConical className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-[0.12em]">Video Export Lab · 7.3F.3</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            Vercel baseline: isolated 720p/30fps/5s main-thread proof. Production export remains frozen.
          </p>
        </div>
        <button className="text-[10px] text-zinc-600 hover:text-zinc-300" onClick={disableLab}>Hide lab</button>
      </div>

      <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2 text-[10px] leading-relaxed text-amber-300/80">
        <AlertTriangle className="mr-1 inline h-3 w-3" />
        Run with the same visual preset on Figma, localhost, and the deployed Vercel URL. Record each benchmark before production promotion.
      </div>

      <Button variant="outline" size="sm" className="w-full" onClick={probe} disabled={probing || isRunning}>
        {probing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
        Probe Runtime Codecs
      </Button>

      {capabilities.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs">Proof codec</Label>
          <SelectWrapper
            value={selectedCodec}
            onValueChange={(value) => setSelectedCodec(value as VideoLabCodec)}
            options={capabilities.map((entry) => ({
              value: entry.codec,
              label: `${codecLabels[entry.codec]} · ${entry.supported ? 'supported' : 'unavailable'}`,
            }))}
          />
          <div className="grid grid-cols-1 gap-1">
            {capabilities.map((entry) => (
              <div key={entry.codec} className="flex items-center justify-between rounded bg-zinc-950/50 px-2 py-1.5 text-[10px]">
                <span className="text-zinc-400">{codecLabels[entry.codec]}</span>
                <span className={entry.supported ? 'text-emerald-400' : 'text-zinc-600'}>
                  {entry.supported ? <CheckCircle2 className="inline h-3 w-3" /> : <XCircle className="inline h-3 w-3" />}
                  {' '}{entry.supported ? 'Ready' : 'No'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Button
        size="sm"
        className="w-full bg-cyan-600 text-white hover:bg-cyan-500"
        onClick={runProof}
        disabled={!selectedCapability?.supported || isRunning}
      >
        {isRunning ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="mr-2 h-3.5 w-3.5" />}
        Run Certified Main-Thread Proof
      </Button>

      {isRunning && (
        <Button variant="outline" size="sm" className="w-full" onClick={() => abortRef.current?.abort()}>
          Cancel Proof Run
        </Button>
      )}

      {progress && (
        <div className="space-y-1">
          <Progress value={progress.percent} className="h-1.5" />
          <p className="text-center text-[10px] text-zinc-500">{progress.message}</p>
        </div>
      )}

      {error && <p className="rounded bg-red-500/10 p-2 text-[10px] text-red-300">{error}</p>}

      {artifact && (
        <div className="space-y-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2">
          <p className="text-[10px] font-medium text-emerald-300">Proof completed and benchmark saved locally.</p>
          <div className="grid grid-cols-2 gap-1 text-[10px] text-zinc-500">
            <span>Total</span><span className="text-right text-zinc-300">{(artifact.benchmark.timings.totalMs / 1000).toFixed(2)}s</span>
            <span>Render</span><span className="text-right text-zinc-300">{(artifact.benchmark.timings.renderMs / 1000).toFixed(2)}s</span>
            <span>Encode submit</span><span className="text-right text-zinc-300">{(artifact.benchmark.timings.encodeSubmitMs / 1000).toFixed(2)}s</span>
            <span>Finalize</span><span className="text-right text-zinc-300">{(artifact.benchmark.timings.muxFinalizeMs / 1000).toFixed(2)}s</span>
            <span>Output</span><span className="text-right text-zinc-300">{(artifact.blob.size / 1024 / 1024).toFixed(2)} MB</span>
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={() => downloadVideoLabArtifact(artifact)}>
            <Download className="mr-2 h-3.5 w-3.5" /> Download Proof Artifact
          </Button>
        </div>
      )}
    </section>
  );
}
