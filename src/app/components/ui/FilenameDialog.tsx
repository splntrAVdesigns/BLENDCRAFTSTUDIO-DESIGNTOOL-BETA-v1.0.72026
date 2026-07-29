import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';

interface FilenameDialogProps {
  defaultFilename: string;
  fileType: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (filename: string) => void;
}

export function FilenameDialog({
  defaultFilename,
  fileType,
  open,
  onClose,
  onConfirm,
}: FilenameDialogProps) {
  const [filename, setFilename] = useState(defaultFilename.replace(`.${fileType}`, ''));

  if (!open) return null;

  const handleConfirm = () => {
    const sanitized = filename.replace(/[^a-z0-9_-]/gi, '_');
    onConfirm(sanitized || defaultFilename);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConfirm();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Export Filename</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="filename">Filename</Label>
            <div className="flex gap-2 items-center">
              <Input
                id="filename"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={defaultFilename}
                className="flex-1 bg-zinc-950 border-zinc-700"
                autoFocus
              />
              <span className="text-sm text-zinc-500">.{fileType}</span>
            </div>
            <p className="text-xs text-zinc-500">
              Special characters will be replaced with underscores
            </p>
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={onClose}
              className="border-zinc-700"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              className="bg-gradient-to-r from-[#0066FF] via-[#0099FF] to-[#00CCFF] hover:from-[#0052CC] hover:via-[#0080DD] hover:to-[#00B8E6]"
            >
              Export
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}