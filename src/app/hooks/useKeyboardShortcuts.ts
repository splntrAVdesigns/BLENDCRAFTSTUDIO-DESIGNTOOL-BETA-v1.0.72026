import { useEffect } from 'react';

export interface KeyboardShortcuts {
  onPlayPause?: () => void;
  onToggleInteraction?: () => void;
  onToggleLeftPanel?: () => void;
  onToggleRightPanel?: () => void;
  onExport?: () => void;
  onReset?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onRecord?: () => void;
  /** STAGE 2.9.0: G (no modifier) — toggle the canvas grid. */
  onToggleGrid?: () => void;
  /** STAGE 3.0.1: A (no modifier) — toggle audio reactive. */
  onToggleAudioReactive?: () => void;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcuts) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.contentEditable === 'true'
      ) {
        return;
      }

      const isMod = event.metaKey || event.ctrlKey;

      // Space: Play/Pause
      if (event.code === 'Space' && !isMod) {
        event.preventDefault();
        shortcuts.onPlayPause?.();
      }

      // I: Toggle Interactive mode
      if (event.code === 'KeyI' && !isMod) {
        event.preventDefault();
        shortcuts.onToggleInteraction?.();
      }

      // [ : Toggle left panel
      if (event.code === 'BracketLeft' && !isMod) {
        event.preventDefault();
        shortcuts.onToggleLeftPanel?.();
      }

      // ] : Toggle right panel
      if (event.code === 'BracketRight' && !isMod) {
        event.preventDefault();
        shortcuts.onToggleRightPanel?.();
      }

      // Cmd/Ctrl + E: Export
      if (event.code === 'KeyE' && isMod) {
        event.preventDefault();
        shortcuts.onExport?.();
      }

      // G (no modifier): toggle canvas grid. Unmodified letter keys are safe
      // here because the handler already ignores input/textarea/contenteditable
      // targets above.
      if (event.code === 'KeyG' && !isMod) {
        event.preventDefault();
        shortcuts.onToggleGrid?.();
      }

      // A (no modifier): toggle audio reactive.
      if (event.code === 'KeyA' && !isMod) {
        event.preventDefault();
        shortcuts.onToggleAudioReactive?.();
      }

      // R (no modifier): Record/Stop Recording
      if (event.code === 'KeyR' && !isMod) {
        event.preventDefault();
        shortcuts.onRecord?.();
      }

      // Cmd/Ctrl + Shift + R: Reset
      if (event.code === 'KeyR' && isMod && event.shiftKey) {
        event.preventDefault();
        shortcuts.onReset?.();
      }

      // Cmd/Ctrl + Z: Undo
      if (event.code === 'KeyZ' && isMod && !event.shiftKey) {
        event.preventDefault();
        shortcuts.onUndo?.();
      }

      // Cmd/Ctrl + Shift + Z or Cmd/Ctrl + Y: Redo
      if ((event.code === 'KeyZ' && isMod && event.shiftKey) || 
          (event.code === 'KeyY' && isMod)) {
        event.preventDefault();
        shortcuts.onRedo?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts]);
}