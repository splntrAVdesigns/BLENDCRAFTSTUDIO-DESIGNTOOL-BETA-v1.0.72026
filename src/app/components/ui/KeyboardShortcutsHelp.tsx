import { useState, useEffect } from 'react';
import { X, Keyboard } from 'lucide-react';
import { Button } from './button';

export function KeyboardShortcutsHelp() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle help with ? key
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        const target = e.target as HTMLElement;
        // Don't trigger if user is typing in an input
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          setIsOpen(prev => !prev);
        }
      }
      // Close with Escape
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const shortcuts = [
    { keys: ['Space'], description: 'Play / Pause animation' },
    { keys: ['I'], description: 'Toggle interactive mode' },
    { keys: ['R'], description: 'Start / Stop recording' },
    { keys: ['['], description: 'Toggle left panel' },
    { keys: [']'], description: 'Toggle right panel' },
    { keys: ['Cmd/Ctrl', 'Z'], description: 'Undo' },
    { keys: ['Cmd/Ctrl', 'Shift', 'Z'], description: 'Redo' },
    { keys: ['Cmd/Ctrl', 'Y'], description: 'Redo (alternative)' },
    { keys: ['Cmd/Ctrl', 'E'], description: 'Export' },
    { keys: ['Cmd/Ctrl', 'Shift', 'R'], description: 'Reset to defaults' },
    { keys: ['?'], description: 'Show keyboard shortcuts' },
    { keys: ['Esc'], description: 'Close dialogs' },
  ];

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        variant="ghost"
        size="sm"
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 bg-zinc-900/80 backdrop-blur-sm border border-zinc-800 hover:bg-zinc-800/80"
        title="Keyboard shortcuts (?)"
      >
        <Keyboard className="w-4 h-4" />
        <span className="text-xs">?</span>
      </Button>
    );
  }

  return (
    <>
      {/* Overlay */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
        onClick={() => setIsOpen(false)}
      />
      
      {/* Dialog */}
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <Keyboard className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-semibold text-zinc-100">Keyboard Shortcuts</h2>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Shortcuts List */}
          <div className="p-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-3">
              {shortcuts.map((shortcut, index) => (
                <div 
                  key={index}
                  className="flex items-center justify-between gap-4 py-2"
                >
                  <span className="text-sm text-zinc-300">{shortcut.description}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {shortcut.keys.map((key, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="text-zinc-600 text-xs">+</span>}
                        <kbd className="px-2 py-1 text-xs font-semibold text-zinc-100 bg-zinc-800 border border-zinc-700 rounded shadow-sm">
                          {key}
                        </kbd>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-zinc-800 bg-zinc-950/50">
            <p className="text-xs text-zinc-500 text-center">
              Press <kbd className="px-1.5 py-0.5 text-xs bg-zinc-800 border border-zinc-700 rounded">?</kbd> to toggle this dialog
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
