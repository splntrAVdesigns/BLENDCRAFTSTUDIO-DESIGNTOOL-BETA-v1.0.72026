import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { KeyboardShortcutsDialog } from '../ui/KeyboardShortcutsDialog';
import { useTooltipContext } from '../../contexts/TooltipContext';
import { BlendcraftLogoSVG } from '../ui/BlendcraftLogoSVG';
import BlendcraftIcon from 'figma:asset/987cf5f33064a7023b59cef30c3e7f415b485d24.png';
import {
  Play,
  Pause,
  Sparkles,
  Move,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Circle,
  StopCircle,
  Video,
  HelpCircle,
  Info,
  Loader2,
  Grid3x3,
} from 'lucide-react';
import { useCanvasGridState, toggleGrid } from '../canvas/useCanvasGrid';
import { useAudioReactiveEnabled, toggleAudioReactive } from '../../audio/audioReactiveState';
import { AudioReactiveMount } from '../../audio/components/AudioReactiveMount';
import { Music } from 'lucide-react';
import { useExportStatus } from '../../state/exportStatus';

interface AppHeaderProps {
  isPlaying: boolean;
  isRecording?: boolean;
  canRecord?: boolean;
  interactionEnabled: boolean;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  onPlayPauseToggle: () => void;
  onRecordToggle?: () => void;
  onInteractionToggle: (enabled: boolean) => void;
  onLeftPanelToggle: () => void;
  onRightPanelToggle: () => void;
  onOpenTutorial?: () => void;
}

export function AppHeader({
  isPlaying,
  isRecording = false,
  canRecord = true,
  interactionEnabled,
  leftPanelCollapsed,
  rightPanelCollapsed,
  onPlayPauseToggle,
  onRecordToggle,
  onInteractionToggle,
  onLeftPanelToggle,
  onRightPanelToggle,
  onOpenTutorial,
}: AppHeaderProps) {
  const { tooltipsEnabled, toggleTooltips } = useTooltipContext();
  /**
   * STAGE 2.7.9 (C): during an export the master RAF loop is gated off
   * (isExportingRef) and the export pipeline drives the canvas directly via
   * renderAtTime(). The canvas is therefore visibly animating while Play reads
   * "Play" and does nothing when clicked — it looks broken. Reflect the real
   * state instead: the transport is owned by the renderer right now.
   */
  const exportStatus = useExportStatus();
  const transportLocked = exportStatus.active;
  // STAGE 2.9.0: grid is a global VIEW preference, so it belongs with the other
  // view toggles (Interactive, Tooltips) rather than in the document panels.
  const grid = useCanvasGridState();
  // STAGE 3.0.1: audio-reactive is a view/mode toggle like Grid — same group.
  const audioReactive = useAudioReactiveEnabled();
  return (
    <header className="border-b border-zinc-800 bg-zinc-900 flex-shrink-0">
      <div className="flex items-center justify-between px-[24px] py-[4px]">
        <div className="flex items-center gap-3">
          {/* Logo lockup: Icon + Text */}
          <div className="flex items-center gap-2">
            <img 
              src={BlendcraftIcon} 
              alt="Blendcraft Studio Icon" 
              className="h-[68px] w-[68px]"
            />
            <BlendcraftLogoSVG className="h-[10px] w-auto" />
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Tutorial Button */}
          {onOpenTutorial && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenTutorial}
              className="text-blue-400 hover:text-blue-300 hover:bg-zinc-800"
              title="Open tutorial"
            >
              <HelpCircle className="w-4 h-4 mr-2" />
              Tutorial
            </Button>
          )}

          {/* Keyboard Shortcuts */}
          <KeyboardShortcutsDialog />

          <div className="w-px h-6 bg-zinc-700" />

          {/* Panel Toggles */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onLeftPanelToggle}
            className="border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800"
            title={leftPanelCollapsed ? 'Show left panel ([)' : 'Hide left panel ([)'}
          >
            {leftPanelCollapsed ? (
              <PanelLeftOpen className="w-4 h-4 text-blue-400" />
            ) : (
              <PanelLeftClose className="w-4 h-4 text-blue-400" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onRightPanelToggle}
            className="border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800"
            title={rightPanelCollapsed ? 'Show right panel (])' : 'Hide right panel (])'}
          >
            {rightPanelCollapsed ? (
              <PanelRightOpen className="w-4 h-4 text-blue-400" />
            ) : (
              <PanelRightClose className="w-4 h-4 text-blue-400" />
            )}
          </Button>

          <div className="w-px h-6 bg-zinc-700" />

          {/* Play/Pause */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onPlayPauseToggle}
            disabled={transportLocked}
            className={
              transportLocked
                ? 'text-blue-300 bg-transparent border-none disabled:opacity-100 cursor-default'
                : isPlaying
                  ? 'text-white hover:text-blue-100 bg-transparent border-none'
                  : 'text-blue-400 hover:text-blue-300 bg-transparent border-none'
            }
            title={
              transportLocked
                ? 'Export is driving playback — the transport resumes when the render finishes'
                : 'Play/Pause (Space)'
            }
          >
            {transportLocked ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin motion-reduce:animate-none" />
                Rendering
              </>
            ) : isPlaying ? (
              <>
                <Pause className="w-4 h-4 mr-2" />
                Pause
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Play
              </>
            )}
          </Button>

          {/* Record Toggle */}
          {onRecordToggle && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRecordToggle}
              className={
                isRecording
                  ? 'text-red-500 hover:text-red-400 bg-transparent border-none'
                  : 'text-blue-400 hover:text-blue-300 bg-transparent border-none'
              }
              title="Record/Stop Recording (R)"
              disabled={!canRecord}
            >
              {isRecording ? (
                <>
                  <StopCircle className="w-4 h-4 mr-2" />
                  Stop
                </>
              ) : (
                <>
                  <Circle className="w-4 h-4 mr-2" />
                  Record
                </>
              )}
            </Button>
          )}

          <div className="w-px h-6 bg-zinc-700" />

          {/* STAGE 2.9.0 — Canvas grid toggle. Sits with the other view
              toggles; a plain button rather than a switch because the two
              sliders it reveals are the real controls. */}
          <button
            type="button"
            onClick={toggleGrid}
            className={`flex items-center gap-2 rounded border px-3 py-2 text-sm transition-colors ${
              grid.enabled
                ? 'border-blue-500/40 bg-blue-500/15 text-blue-300'
                : 'border-transparent bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
            title="Toggle canvas grid (G)"
            aria-pressed={grid.enabled}
          >
            <Grid3x3 className={`h-4 w-4 ${grid.enabled ? 'text-blue-400' : 'text-zinc-500'}`} />
            Grid
          </button>

          {/* STAGE 3.0.1 — Audio-Reactive toggle. Same button style as Grid;
              arms the feature and shows the bottom-left panel. Off by default. */}
          <button
            type="button"
            onClick={toggleAudioReactive}
            className={`flex items-center gap-2 rounded border px-3 py-2 text-sm transition-colors ${
              audioReactive
                ? 'border-blue-500/40 bg-blue-500/15 text-blue-300'
                : 'border-transparent bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
            title="Toggle Audio Reactive (A)"
            aria-pressed={audioReactive}
          >
            <Music className={`h-4 w-4 ${audioReactive ? 'text-blue-400' : 'text-zinc-500'}`} />
            Audio
          </button>

          {/* STAGE 3.0.1a — SELF-MOUNTING AUDIO FEATURE.
              Renders nothing here; it portals the panel into the canvas area
              and owns the engine lifecycle. Living next to the toggle that
              controls it guarantees ONE store instance and ONE mount point, so
              the button and the panel can never disagree. App.tsx needs no
              audio code at all. */}
          <AudioReactiveMount
            isPlaying={isPlaying}
            onPlayPauseToggle={onPlayPauseToggle}
          />

          <div className="w-px h-6 bg-zinc-700" />

          {/* Interactive Toggle */}
          <div className="flex items-center gap-2 px-3 py-2 rounded bg-zinc-900 border border-transparent">
            <Move className="w-4 h-4 text-blue-400" />
            <Label className="text-sm cursor-pointer" htmlFor="interaction-toggle">
              Interactive
            </Label>
            <Switch
              id="interaction-toggle"
              checked={interactionEnabled}
              onCheckedChange={onInteractionToggle}
              title="Toggle Interactive Mode (I)"
            />
          </div>

          {/* Tooltip Toggle */}
          <div className="flex items-center gap-2 px-3 py-2 rounded bg-zinc-900 border border-transparent">
            <Info className="w-4 h-4 text-blue-400" />
            <Label className="text-sm cursor-pointer text-[#51a2ff]" htmlFor="tooltips-toggle">
              Tooltips
            </Label>
            <Switch
              id="tooltips-toggle"
              checked={tooltipsEnabled}
              onCheckedChange={toggleTooltips}
              title="Toggle tooltips"
            />
          </div>
        </div>
      </div>
    </header>
  );
}