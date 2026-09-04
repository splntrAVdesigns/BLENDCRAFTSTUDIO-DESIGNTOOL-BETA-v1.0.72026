import { useState } from 'react';
import { GradientPreset, Layer, CanvasSettings } from '../../types/gradient';
import { DEFAULT_PRESETS, saveCustomPreset, deleteCustomPreset, loadCustomPresets } from '../../utils/presets';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ScrollArea } from '../ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Save, Trash2, Download, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface PresetSelectorProps {
  onLoadPreset: (preset: GradientPreset) => void;
  currentLayers: Layer[];
  currentCanvasSettings: CanvasSettings;
}

export function PresetSelector({ 
  onLoadPreset, 
  currentLayers, 
  currentCanvasSettings 
}: PresetSelectorProps) {
  const [customPresets, setCustomPresets] = useState<GradientPreset[]>(loadCustomPresets());
  const [saveName, setSaveName] = useState('');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  const handleSavePreset = () => {
    if (!saveName.trim()) {
      toast.error('Please enter a preset name');
      return;
    }

    const newPreset: GradientPreset = {
      id: `custom-${Date.now()}`,
      name: saveName,
      layers: currentLayers,
      canvasSettings: currentCanvasSettings,
      tags: ['custom'],
    };

    saveCustomPreset(newPreset);
    setCustomPresets(loadCustomPresets());
    setSaveName('');
    setSaveDialogOpen(false);
    toast.success('Preset saved!');
  };

  const handleDeletePreset = (presetId: string) => {
    deleteCustomPreset(presetId);
    setCustomPresets(loadCustomPresets());
    toast.success('Preset deleted!');
  };

  const PresetCard = ({ preset, isCustom = false }: { preset: GradientPreset; isCustom?: boolean }) => {
    // Generate CSS gradient for preview
    const previewGradient = preset.layers[0]?.gradient 
      ? (() => {
          const colors = preset.layers[0].gradient.colors;
          const colorStops = colors.map(c => `${c.color} ${c.position * 100}%`).join(', ');
          
          switch (preset.layers[0].gradient.type) {
            case 'linear':
              return `linear-gradient(${preset.layers[0].gradient.angle || 135}deg, ${colorStops})`;
            case 'radial':
              return `radial-gradient(circle, ${colorStops})`;
            case 'conic':
              return `conic-gradient(${colorStops})`;
            default:
              return `linear-gradient(135deg, ${colorStops})`;
          }
        })()
      : 'linear-gradient(135deg, #667eea, #764ba2)';
    
    // Check if this is the Electric preset
    const isElectric = preset.id === 'preset-electric';

    return (
      <div
        className={`group relative p-2.5 rounded-lg bg-zinc-900 transition-all cursor-pointer ${
          isElectric 
            ? 'border-2 border-cyan-400 shadow-lg shadow-cyan-400/20' 
            : 'border border-zinc-800 hover:border-zinc-700'
        }`}
        onClick={() => {
          onLoadPreset(preset);
          toast.success(`Loaded: ${preset.name}`);
        }}
      >
        {/* Preview with actual gradient */}
        <div 
          className="w-full h-16 rounded-md mb-2 overflow-hidden"
          style={{ background: previewGradient }}
        />

        {/* Info */}
        <div className="space-y-1">
          <h4 className="font-medium text-xs text-zinc-100 truncate">{preset.name}</h4>
          <div className="flex items-center gap-1 flex-wrap">
            {preset.tags?.slice(0, 2).map(tag => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Delete button for custom presets */}
        {isCustom && (
          <Button
            size="sm"
            variant="ghost"
            className="absolute top-2 right-2 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-950 hover:text-red-400"
            onClick={(e) => {
              e.stopPropagation();
              handleDeletePreset(preset.id);
            }}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-zinc-100">Presets</h3>
        <Button
          size="sm"
          onClick={() => setSaveDialogOpen(!saveDialogOpen)}
          className="bg-gradient-to-r from-[#0066FF] via-[#0099FF] to-[#00CCFF] hover:from-[#0052CC] hover:via-[#0080DD] hover:to-[#00B8E6] text-white border-none shadow-lg shadow-blue-500/20"
        >
          <Save className="w-4 h-4 mr-1" />
          Save
        </Button>
      </div>

      {/* Save Dialog */}
      {saveDialogOpen && (
        <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800 space-y-3">
          <Label>Preset Name</Label>
          <Input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="My Awesome Gradient"
            className="bg-zinc-950 border-zinc-800"
            onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
          />
          <div className="flex gap-2">
            <Button onClick={handleSavePreset} size="sm" className="flex-1 bg-blue-600 hover:bg-blue-700">
              Save Preset
            </Button>
            <Button
              onClick={() => setSaveDialogOpen(false)}
              size="sm"
              variant="outline"
              className="flex-1 bg-zinc-950 border-zinc-800"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="default" className="w-full">
        <TabsList className="grid w-full grid-cols-2 bg-zinc-900">
          <TabsTrigger value="default">
            <Sparkles className="w-4 h-4 mr-2" />
            Default
          </TabsTrigger>
          <TabsTrigger value="custom">
            <Download className="w-4 h-4 mr-2" />
            Custom ({customPresets.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="default">
          <ScrollArea className="h-[400px] pr-4">
            <div className="grid grid-cols-1 gap-3">
              {DEFAULT_PRESETS.map(preset => (
                <PresetCard key={preset.id} preset={preset} />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="custom">
          <ScrollArea className="h-[400px] pr-4">
            {customPresets.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-6">
                <Save className="w-12 h-12 text-zinc-700 mb-3" />
                <p className="text-sm text-zinc-400">No custom presets yet</p>
                <p className="text-xs text-zinc-600 mt-1">
                  Create a gradient and save it to build your library
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {customPresets.map(preset => (
                  <PresetCard key={preset.id} preset={preset} isCustom />
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
