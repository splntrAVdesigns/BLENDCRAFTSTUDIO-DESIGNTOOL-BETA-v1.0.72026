import { useState } from 'react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { SelectWrapper } from '../ui/select-wrapper';
import type { SelectOption } from '../ui/select-wrapper';
import { 
  Star, 
  Download, 
  Upload, 
  Trash2, 
  Plus,
  Search,
  Heart,
  Sparkles,
  Zap,
  Waves,
  Palette,
  Minus,
  Save
} from 'lucide-react';
import { useAnimationPresets, AnimationPreset } from '../../hooks/useAnimationPresets';
import { AnimationConfig } from '../../types/gradient';
import { toast } from 'sonner';
import { validateUploadFile, validateJsonImportText } from '../../utils/uploadValidation';

interface AnimationPresetsPanelProps {
  currentAnimation: AnimationConfig;
  onApplyPreset: (animation: AnimationConfig) => void;
  onSaveCurrentAsPreset?: () => void;
}

export function AnimationPresetsPanel({ 
  currentAnimation, 
  onApplyPreset,
  onSaveCurrentAsPreset 
}: AnimationPresetsPanelProps) {
  const {
    allPresets,
    favoritePresets,
    getPresetsByCategory,
    savePreset,
    deletePreset,
    toggleFavorite,
    exportPresets,
    importPresets,
  } = useAnimationPresets();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'favorites' | AnimationPreset['category']>('all');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetDescription, setNewPresetDescription] = useState('');
  const [newPresetCategory, setNewPresetCategory] = useState<AnimationPreset['category']>('custom');

  // Filter presets
  const filteredPresets = allPresets.filter(preset => {
    const matchesSearch = preset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         preset.description.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (selectedCategory === 'all') return matchesSearch;
    if (selectedCategory === 'favorites') return matchesSearch && preset.isFavorite;
    return matchesSearch && preset.category === selectedCategory;
  });

  const handleApplyPreset = (preset: AnimationPreset) => {
    onApplyPreset(preset.animation);
    toast.success(`Applied "${preset.name}" preset`);
  };

  const handleSavePreset = () => {
    if (!newPresetName.trim()) {
      toast.error('Please enter a preset name');
      return;
    }

    try {
      savePreset(
        newPresetName.trim(),
        newPresetDescription.trim() || 'Custom animation preset',
        currentAnimation,
        newPresetCategory
      );
      
      toast.success('Preset saved successfully!');
      setShowSaveDialog(false);
      setNewPresetName('');
      setNewPresetDescription('');
      setNewPresetCategory('custom');
    } catch (error) {
      toast.error('Failed to save preset');
    }
  };

  const handleDeletePreset = (presetId: string) => {
    try {
      deletePreset(presetId);
      toast.success('Preset deleted');
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const handleExportPresets = () => {
    try {
      const json = exportPresets(allPresets.map(p => p.id));
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `blendcraft-animation-presets-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Presets exported successfully!');
    } catch (error) {
      toast.error('Failed to export presets');
    }
  };

  const handleImportPresets = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const fileValidation = validateUploadFile(file, 'json-import');
        if (!fileValidation.ok) {
          toast.error(fileValidation.error || 'Invalid preset import file');
          input.value = '';
          return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const json = event.target?.result as string;
            const jsonValidation = validateJsonImportText(json);
            if (!jsonValidation.ok) {
              toast.error(jsonValidation.error || 'Invalid preset import JSON');
              return;
            }
            const count = importPresets(json);
            toast.success(`Imported ${count} preset${count !== 1 ? 's' : ''}`);
          } catch (error) {
            toast.error((error as Error).message);
          }
        };
        reader.onerror = () => toast.error('Unable to read preset import file');
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const getCategoryIcon = (category: AnimationPreset['category']) => {
    switch (category) {
      case 'smooth': return <Waves className="size-4" />;
      case 'energetic': return <Zap className="size-4" />;
      case 'chaotic': return <Sparkles className="size-4" />;
      case 'artistic': return <Palette className="size-4" />;
      case 'minimal': return <Minus className="size-4" />;
      default: return <Star className="size-4" />;
    }
  };

  // Category options for SelectWrapper
  const categoryOptions: SelectOption[] = [
    { value: 'smooth', label: 'Smooth' },
    { value: 'energetic', label: 'Energetic' },
    { value: 'chaotic', label: 'Chaotic' },
    { value: 'artistic', label: 'Artistic' },
    { value: 'minimal', label: 'Minimal' },
    { value: 'custom', label: 'Custom' },
  ];

  return (
    <div className="space-y-4">
      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-lg space-y-3">
          <Label className="text-xs text-zinc-400">Save Current Animation</Label>
          <Input
            placeholder="Preset name..."
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            className="bg-zinc-950 border-zinc-700 text-zinc-100"
          />
          <Textarea
            placeholder="Description (optional)..."
            value={newPresetDescription}
            onChange={(e) => setNewPresetDescription(e.target.value)}
            className="bg-zinc-950 border-zinc-700 text-zinc-100 resize-none"
            rows={2}
          />
          <SelectWrapper
            value={newPresetCategory}
            onValueChange={(v) => setNewPresetCategory(v as AnimationPreset['category'])}
            options={categoryOptions}
            triggerClassName="bg-zinc-950 border-zinc-700 text-zinc-100"
            contentClassName="bg-zinc-900 border-zinc-700"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleSavePreset}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              Save Preset
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowSaveDialog(false)}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Search and Action Buttons */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
          <Input
            placeholder="Search presets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-zinc-950 border-zinc-700 text-zinc-100"
          />
        </div>
        <button
          onClick={() => setShowSaveDialog(!showSaveDialog)}
          className="size-9 flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-colors"
          title="Save preset"
        >
          <Save className="size-4" />
        </button>
        <button
          onClick={handleImportPresets}
          className="size-9 flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-colors"
          title="Import presets"
        >
          <Upload className="size-4" />
        </button>
        <button
          onClick={handleExportPresets}
          className="size-9 flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-colors"
          title="Export presets"
        >
          <Download className="size-4" />
        </button>
      </div>

      {/* Category Filter */}
      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          variant={selectedCategory === 'all' ? 'default' : 'outline'}
          onClick={() => setSelectedCategory('all')}
          className={selectedCategory === 'all' ? 'bg-blue-600' : 'border-zinc-700 text-zinc-300'}
        >
          All
        </Button>
        <Button
          size="sm"
          variant={selectedCategory === 'favorites' ? 'default' : 'outline'}
          onClick={() => setSelectedCategory('favorites')}
          className={selectedCategory === 'favorites' ? 'bg-blue-600' : 'border-zinc-700 text-zinc-300'}
        >
          Favorites
        </Button>
        {(['smooth', 'energetic', 'chaotic', 'artistic', 'minimal', 'custom'] as const).map(category => (
          <Button
            key={category}
            size="sm"
            variant={selectedCategory === category ? 'default' : 'outline'}
            onClick={() => setSelectedCategory(category)}
            className={selectedCategory === category ? 'bg-blue-600' : 'border-zinc-700 text-zinc-300'}
          >
            <span className="capitalize">{category}</span>
          </Button>
        ))}
      </div>

      {/* Presets Grid */}
      <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
        {filteredPresets.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 text-sm">
            No presets found
          </div>
        ) : (
          filteredPresets.map(preset => (
            <div
              key={preset.id}
              className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-lg hover:bg-zinc-900 transition-colors group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium text-sm text-zinc-100 truncate">{preset.name}</h4>
                    {preset.isBuiltIn && (
                      <span className="text-xs px-1.5 py-0.5 bg-blue-600/20 text-blue-400 rounded">
                        Built-in
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 line-clamp-2">{preset.description}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-zinc-600">
                    <span>{preset.animation.type}</span>
                    <span>•</span>
                    <span>Speed: {preset.animation.speed}x</span>
                    <span>•</span>
                    <span>Intensity: {Math.round(preset.animation.intensity * 100)}%</span>
                  </div>
                </div>
                
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleFavorite(preset.id)}
                    className="size-8 p-0"
                  >
                    <Heart 
                      className={`size-4 ${preset.isFavorite ? 'fill-red-500 text-red-500' : 'text-zinc-500'}`}
                    />
                  </Button>
                  {!preset.isBuiltIn && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeletePreset(preset.id)}
                      className="size-8 p-0 opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="size-4 text-red-500" />
                    </Button>
                  )}
                </div>
              </div>
              
              <Button
                size="sm"
                onClick={() => handleApplyPreset(preset)}
                variant="outline"
                className="w-full mt-3 bg-transparent hover:bg-zinc-800 text-zinc-100 border"
                style={{ borderColor: '#51A2FF', borderWidth: '1px' }}
              >
                Apply Preset
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Stats */}
      <div className="text-xs text-zinc-600 text-center pt-2 border-t border-zinc-800">
        {filteredPresets.length} preset{filteredPresets.length !== 1 ? 's' : ''} 
        {selectedCategory !== 'all' && ` in ${selectedCategory}`}
      </div>
    </div>
  );
}