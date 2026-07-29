import { Loader2 } from 'lucide-react';

export function LoadingCanvas() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-zinc-900 rounded-lg">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
        <p className="text-sm text-zinc-400">Initializing canvas...</p>
      </div>
    </div>
  );
}
