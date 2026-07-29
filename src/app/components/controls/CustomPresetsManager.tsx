import { useState, useRef } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ScrollArea } from '../ui/scroll-area';
import { 
  Save, 
  Trash2, 
  Download, 
  Upload, 
  Plus,
  X,
  Check
} from 'lucide-react';
import { toast } from 'sonner';
import { Layer, CanvasSettings } from '../../types/gradient';
import { useCustomPresets, CustomPreset } from '../../hooks/useCustomPresets';

interface CustomPresetsManagerProps {
  currentLayers: Layer[];
  currentCanvasSettings: CanvasSettings;
  onLoadPreset: (layers: Layer[], canvasSettings: CanvasSettings) => void;
}

export function CustomPresetsManager({
  currentLayers,
  currentCanvasSettings,
  onLoadPreset,
}: CustomPresetsManagerProps) {
  const {
    customPresets,
    savePreset,
    deletePreset,
    exportPresets,
    importPresets,
  } = useCustomPresets();

  const [isCreating, setIsCreating] = useState(false);
  const [presetName, setPresetName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSavePreset = () => {
    if (!presetName.trim()) {
      toast.error('Please enter a preset name');
      return;
    }

    try {
      savePreset(presetName.trim(), currentLayers, currentCanvasSettings);
      toast.success(`Preset "${presetName}" saved!`);
      setPresetName('');
      setIsCreating(false);
    } catch (error) {
      toast.error('Failed to save preset');
      console.error(error);
    }
  };

  const handleLoadPreset = (preset: CustomPreset) => {
    onLoadPreset(preset.layers, preset.canvasSettings);
    toast.success(`Loaded preset "${preset.name}"`);
  };

  const handleDeletePreset = (id: string, name: string) => {
    if (confirm(`Delete preset "${name}"?`)) {
      deletePreset(id);
      toast.success('Preset deleted');
    }
  };

  const handleExport = () => {
    try {
      exportPresets();
      toast.success('Presets exported successfully');
    } catch (error) {
      toast.error('Failed to export presets');
      console.error(error);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const count = await importPresets(file);
      toast.success(`Imported ${count} preset(s)`);
    } catch (error) {
      toast.error('Failed to import presets');
      console.error(error);
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">Custom Presets</h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="border-zinc-700 hover:border-zinc-600"
            title="Import presets"
          >
            <Upload className="w-3 h-3" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={customPresets.length === 0}
            className="border-zinc-700 hover:border-zinc-600"
            title="Export presets"
          >
            <Download className="w-3 h-3" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCreating(true)}
            className="border-zinc-700 hover:border-zinc-600"
          >
            <Plus className="w-3 h-3 mr-1" />
            New
          </Button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImport}
        className="hidden"
      />

      {isCreating && (
        <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg space-y-2">
          <Label className="text-xs text-zinc-400">Preset Name</Label>
          <Input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="My Custom Gradient"
            className="bg-zinc-950 border-zinc-800"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSavePreset();
              if (e.key === 'Escape') setIsCreating(false);
            }}
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleSavePreset}
              className="flex-1 bg-gradient-to-r from-[#0066FF] via-[#0099FF] to-[#00CCFF] hover:from-[#0052CC] hover:via-[#0080DD] hover:to-[#00B8E6] text-white border-none shadow-lg shadow-blue-500/20"
            >
              <Check className="w-3 h-3 mr-1" />
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsCreating(false)}
              className="border-zinc-700"
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}

      {customPresets.length === 0 ? (
        <div className="text-center py-8 text-zinc-500 text-sm">
          <Save className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No custom presets yet</p>
          <p className="text-xs mt-1">Create one to save your current gradient</p>
        </div>
      ) : (
        <ScrollArea className="h-[300px]">
          <div className="space-y-2">
            {customPresets.map((preset) => (
              <div
                key={preset.id}
                className="group p-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors cursor-pointer"
                onClick={() => handleLoadPreset(preset)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-zinc-200 truncate">
                      {preset.name}
                    </h4>
                    <p className="text-xs text-zinc-500">
                      {new Date(preset.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeletePreset(preset.id, preset.name);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}