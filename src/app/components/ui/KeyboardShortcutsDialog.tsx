import { useEffect, useState } from 'react';
import { Keyboard, X } from 'lucide-react';
import { Button } from './button';

export function KeyboardShortcutsDialog() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Show shortcuts on ? key
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement;
        if (
          target.tagName !== 'INPUT' &&
          target.tagName !== 'TEXTAREA' &&
          target.contentEditable !== 'true'
        ) {
          e.preventDefault();
          setIsOpen(true);
        }
      }
      // Close on Escape
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800"
        title="Keyboard Shortcuts (?)"
      >
        <Keyboard className="w-4 h-4 text-blue-400" />
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-[#5200FF]" />
            <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsOpen(false)}
            className="h-8 w-8 p-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-zinc-300">Playback</h4>
            <ShortcutItem shortcut="Space" description="Play / Pause animation" />
            <ShortcutItem shortcut="R" description="Start / Stop recording" />
            <ShortcutItem shortcut="I" description="Toggle Interactive mode" />
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-zinc-300">Interface</h4>
            <ShortcutItem shortcut="[" description="Toggle left panel" />
            <ShortcutItem shortcut="]" description="Toggle right panel" />
            <ShortcutItem shortcut="?" description="Show keyboard shortcuts" />
            <ShortcutItem shortcut="Shift + P" description="Toggle FPS monitor" />
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-zinc-300">History</h4>
            <ShortcutItem shortcut="Cmd + Z" description="Undo" />
            <ShortcutItem shortcut="Cmd + Shift + Z" description="Redo" />
            <ShortcutItem shortcut="Cmd + Y" description="Redo (alternative)" />
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-zinc-300">Actions</h4>
            <ShortcutItem shortcut="Cmd + E" description="Export gradient" />
            <ShortcutItem shortcut="Cmd + Shift + R" description="Reset to defaults" />
            <ShortcutItem shortcut="Esc" description="Close dialogs" />
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-zinc-800">
          <p className="text-xs text-zinc-500 text-center">
            ⌘ = Cmd on Mac, Ctrl on Windows/Linux
          </p>
        </div>
      </div>
    </div>
  );
}

function ShortcutItem({ shortcut, description }: { shortcut: string; description: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-zinc-400">{description}</span>
      <div className="flex gap-1">
        {shortcut.split(' + ').map((key, i) => (
          <kbd
            key={i}
            className="px-2 py-1 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded"
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
}