import React from 'react';
import { Undo, Redo, Trash2, Clock } from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import type { HistoryState } from '../../hooks/useHistory';

interface HistoryTimelineProps {
  history: HistoryState[];
  currentIndex: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onGoToState: (index: number) => void;
  onClearHistory: () => void;
}

export function HistoryTimeline({
  history,
  currentIndex,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onGoToState,
  onClearHistory,
}: HistoryTimelineProps) {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getTimeSince = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                onClick={onUndo}
                disabled={!canUndo}
                className="flex-1"
              >
                <Undo className="w-4 h-4 mr-2" />
                Undo
              </Button>
            </TooltipTrigger>
            <TooltipContent>Cmd+Z</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                onClick={onRedo}
                disabled={!canRedo}
                className="flex-1"
              >
                <Redo className="w-4 h-4 mr-2" />
                Redo
              </Button>
            </TooltipTrigger>
            <TooltipContent>Cmd+Shift+Z</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                onClick={onClearHistory}
                disabled={history.length === 0}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear History</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <Clock className="w-3 h-3" />
        <span>
          {history.length} state{history.length !== 1 ? 's' : ''} in history
        </span>
      </div>

      {/* Timeline */}
      <ScrollArea className="h-[280px] border border-zinc-800 rounded bg-zinc-950">
        <div className="p-2 space-y-1">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-zinc-500">
              <Clock className="w-8 h-8 mb-2" />
              <p className="text-sm">No history yet</p>
              <p className="text-xs mt-1">Make changes to start tracking history</p>
            </div>
          ) : (
            history.map((state, index) => {
              const isCurrent = index === currentIndex;
              const isPast = index < currentIndex;
              const isFuture = index > currentIndex;

              return (
                <button
                  key={state.timestamp}
                  onClick={() => onGoToState(index)}
                  className={`
                    w-full text-left p-2 rounded-lg border transition-all
                    ${isCurrent
                      ? 'bg-gradient-to-r from-[#0066FF] to-[#00CCFF] border-blue-400 text-white shadow-lg shadow-blue-500/20'
                      : isPast
                      ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:bg-zinc-900'
                    }
                  `}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {isCurrent && (
                        <div className="w-1.5 h-1.5 bg-green-400 rounded-full flex-shrink-0" />
                      )}
                      <span className="text-xs font-medium">
                        State #{index + 1}
                      </span>
                      <span className="text-[10px] opacity-60 truncate">
                        {state.layers.length} layer{state.layers.length !== 1 ? 's' : ''}
                        {' • '}
                        {state.layers.find(l => l.id === state.activeLayerId)?.gradient.type || 'linear'}
                      </span>
                    </div>

                    <div className="text-[10px] opacity-50 whitespace-nowrap flex-shrink-0">
                      {getTimeSince(state.timestamp)}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Keyboard shortcuts hint */}
      <div className="text-xs text-zinc-500 space-y-1">
        <div className="flex justify-between">
          <span>Undo</span>
          <span className="font-mono">Cmd+Z</span>
        </div>
        <div className="flex justify-between">
          <span>Redo</span>
          <span className="font-mono">Cmd+Shift+Z</span>
        </div>
      </div>
    </div>
  );
}