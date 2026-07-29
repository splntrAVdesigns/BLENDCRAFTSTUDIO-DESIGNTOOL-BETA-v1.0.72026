import React, { useState } from 'react';
import { Shuffle, Sparkles, Wand2, Copy, RefreshCw, Undo2, Zap, Star } from 'lucide-react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Card } from '../ui/card';
import { SelectWrapper } from '../ui/select-wrapper';
import { Slider } from '../ui/slider';
import { ScrollArea } from '../ui/scroll-area';
import { toast } from 'sonner';
import {
  generateRandomGradient,
  generateVariations,
  generateFromMood,
  generateSmartRefine,
  getStyleDescription,
  getMoodDescription,
  type GradientStyle,
  type GradientMood,
} from '../../utils/gradientRandomizer';
import type { GradientConfig, GradientType } from '../../types/gradient';

interface GradientRandomizerPanelProps {
  currentGradient: GradientConfig;
  onGradientGenerated: (gradient: GradientConfig) => void;
}

export function GradientRandomizerPanel({ 
  currentGradient, 
  onGradientGenerated 
}: GradientRandomizerPanelProps) {
  const [style, setStyle] = useState<GradientStyle>('vibrant');
  const [mood, setMood] = useState<GradientMood>('energetic');
  const [colorCount, setColorCount] = useState(3);
  const [gradientType, setGradientType] = useState<GradientType | 'random'>('random');
  const [variations, setVariations] = useState<GradientConfig[]>([]);
  const [showVariations, setShowVariations] = useState(false);
  
  // Undo history for randomization
  const [gradientHistory, setGradientHistory] = useState<GradientConfig[]>([]);

  const styles: GradientStyle[] = [
    'vibrant', 'pastel', 'dark', 'neon',
    'earth', 'ocean', 'sunset', 'aurora',
    'monochrome', 'random'
  ];

  const moods: GradientMood[] = [
    'energetic', 'calm', 'mysterious', 'warm',
    'cool', 'natural', 'futuristic', 'romantic'
  ];

  const styleOptions = styles.map(s => ({ 
    value: s, 
    label: s.charAt(0).toUpperCase() + s.slice(1) 
  }));

  const moodOptions = moods.map(m => ({ 
    value: m, 
    label: m.charAt(0).toUpperCase() + m.slice(1) 
  }));

  const gradientTypeOptions = [
    { value: 'random', label: 'Random' },
    { value: 'linear', label: 'Linear' },
    { value: 'radial', label: 'Radial' },
    { value: 'conic', label: 'Conic' },
    { value: 'diamond', label: 'Diamond' },
  ];

  const handleRandomize = () => {
    const gradient = generateRandomGradient({
      style,
      colorCount,
      gradientType: gradientType === 'random' ? undefined : gradientType,
      useHarmony: Math.random() > 0.5,
    });

    // Add current gradient to history
    setGradientHistory(prevHistory => [...prevHistory, currentGradient]);

    onGradientGenerated(gradient);
    toast.success('New gradient generated!');
  };

  const handleMoodGenerate = () => {
    const gradient = generateFromMood(mood);
    onGradientGenerated(gradient);
    toast.success(`Generated ${mood} gradient!`);
  };

  const handleGenerateVariations = () => {
    const newVariations = generateVariations(currentGradient, 8);
    setVariations(newVariations);
    setShowVariations(true);
    toast.success('Generated 8 variations!');
  };

  const handleApplyVariation = (variation: GradientConfig) => {
    onGradientGenerated(variation);
    toast.success('Variation applied!');
  };

  const handleUndo = () => {
    if (gradientHistory.length > 0) {
      const lastGradient = gradientHistory[gradientHistory.length - 1];
      setGradientHistory(prevHistory => prevHistory.slice(0, -1));
      onGradientGenerated(lastGradient);
      toast.success('Undo successful!');
    } else {
      toast.error('No more undo history available!');
    }
  };

  const handleSmartRefine = () => {
    const refinedVariations = generateSmartRefine(currentGradient, 6);
    setVariations(refinedVariations);
    setShowVariations(true);
    toast.success('Generated 6 refined variations!');
  };

  const renderGradientPreview = (gradient: GradientConfig, onClick?: () => void) => {
    let backgroundStyle: string;

    switch (gradient.type) {
      case 'linear':
        backgroundStyle = `linear-gradient(${gradient.angle}deg, ${gradient.colors
          .map(c => `${c.color} ${c.position * 100}%`)
          .join(', ')})`;
        break;
      case 'radial':
        backgroundStyle = `radial-gradient(circle at ${gradient.centerX * 100}% ${gradient.centerY * 100}%, ${gradient.colors
          .map(c => `${c.color} ${c.position * 100}%`)
          .join(', ')})`;
        break;
      case 'conic':
        backgroundStyle = `conic-gradient(from ${gradient.angle}deg at ${gradient.centerX * 100}% ${gradient.centerY * 100}%, ${gradient.colors
          .map(c => `${c.color} ${c.position * 360}deg`)
          .join(', ')})`;
        break;
      case 'voronoi':
        // CSS approximation - use radial gradient
        backgroundStyle = `radial-gradient(circle, ${gradient.colors
          .map(c => `${c.color} ${c.position * 100}%`)
          .join(', ')})`;
        break;
      case 'diamond':
        // CSS approximation - use conic gradient
        backgroundStyle = `conic-gradient(${gradient.colors
          .map(c => `${c.color} ${c.position * 360}deg`)
          .join(', ')})`;
        break;
      default:
        backgroundStyle = `linear-gradient(180deg, ${gradient.colors
          .map(c => `${c.color} ${c.position * 100}%`)
          .join(', ')})`;
    }

    return (
      <div
        className="w-full h-16 rounded border-2 border-zinc-700 hover:border-zinc-500 cursor-pointer transition-all shadow-lg"
        style={{ background: backgroundStyle }}
        onClick={onClick}
      />
    );
  };

  return (
    <div className="space-y-4">
      {/* Quick Randomize */}
      <Card className="p-3 bg-zinc-900 border-zinc-800">
        <div className="flex gap-2">
          <Button
            onClick={handleRandomize}
            className="flex-1 bg-gradient-to-r from-[#0066FF] via-[#0099FF] to-[#00CCFF] hover:from-[#0052CC] hover:via-[#0080DD] hover:to-[#00B8E6] text-white border-none shadow-lg shadow-blue-500/20"
            size="lg"
          >
            <Shuffle className="w-5 h-5 mr-2" />
            Randomize
          </Button>
          <Button
            onClick={handleGenerateVariations}
            variant="outline"
            size="lg"
          >
            <Wand2 className="w-5 h-5" />
          </Button>
          <Button
            onClick={handleUndo}
            variant="outline"
            size="lg"
          >
            <Undo2 className="w-5 h-5" />
          </Button>
          <Button
            onClick={handleSmartRefine}
            variant="outline"
            size="lg"
          >
            <Zap className="w-5 h-5" />
          </Button>
        </div>
      </Card>

      {/* Style Selection */}
      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Style</Label>
        <SelectWrapper 
          value={style} 
          onValueChange={(v) => setStyle(v as GradientStyle)}
          options={styleOptions}
          triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
          contentClassName="bg-zinc-900 border-zinc-700"
        />
        <p className="text-xs text-zinc-500">{getStyleDescription(style)}</p>
      </div>

      {/* Mood Selection */}
      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Mood</Label>
        <SelectWrapper 
          value={mood} 
          onValueChange={(v) => setMood(v as GradientMood)}
          options={moodOptions}
          triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
          contentClassName="bg-zinc-900 border-zinc-700"
        />
        <p className="text-xs text-zinc-500">{getMoodDescription(mood)}</p>
        <Button
          onClick={handleMoodGenerate}
          variant="outline"
          size="sm"
          className="w-full"
          style={{ backgroundColor: '#262626' }}
        >
          <Sparkles className="w-4 h-4 mr-2" />
          Generate from Mood
        </Button>
      </div>

      {/* Color Count */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <Label>Color Count</Label>
          <span className="text-sm text-[#51a2ff]">{colorCount}</span>
        </div>
        <Slider
          value={[colorCount]}
          onValueChange={([v]) => setColorCount(v)}
          min={2}
          max={6}
          step={1}
        />
      </div>

      {/* Gradient Type */}
      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Gradient Type</Label>
        <SelectWrapper 
          value={gradientType} 
          onValueChange={(v) => setGradientType(v as any)}
          options={gradientTypeOptions}
          triggerClassName="border-zinc-700 text-zinc-100 hover:border-zinc-600"
          contentClassName="bg-zinc-900 border-zinc-700"
        />
      </div>

      {/* Variations */}
      {showVariations && variations.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Variations</Label>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleGenerateVariations}
              className="h-7"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              <span className="text-xs">Regenerate</span>
            </Button>
          </div>
          <ScrollArea className="h-[250px] border border-zinc-800 rounded-lg bg-zinc-950">
            <div className="p-2 grid grid-cols-2 gap-2">
              {variations.map((variation, index) => (
                <div
                  key={index}
                  className="space-y-1"
                >
                  {renderGradientPreview(variation, () => handleApplyVariation(variation))}
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-zinc-500">
                      #{index + 1}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleApplyVariation(variation)}
                      className="h-6 text-xs px-2"
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Current Gradient Preview */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Current Gradient</Label>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              // Save to favorites
              const favorites = JSON.parse(localStorage.getItem('gradient-favorites') || '[]');
              const newFavorite = {
                id: `fav-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                name: `Gradient ${favorites.length + 1}`,
                gradient: currentGradient,
                timestamp: Date.now(),
              };
              const updatedFavorites = [newFavorite, ...favorites];
              localStorage.setItem('gradient-favorites', JSON.stringify(updatedFavorites));
              window.dispatchEvent(new CustomEvent('gradientFavoritesUpdated'));
              toast.success(`Saved "${newFavorite.name}" to favorites!`);
            }}
            className="h-7 text-xs"
          >
            <Star className="w-3 h-3 mr-1" />
            Save
          </Button>
        </div>
        {renderGradientPreview(currentGradient)}
        <div className="text-xs text-zinc-500 space-y-1">
          <div className="flex justify-between">
            <span>Type:</span>
            <span className="capitalize text-[#51a2ff]">{currentGradient.type}</span>
          </div>
          <div className="flex justify-between">
            <span>Colors:</span>
            <span className="text-[#51a2ff]">{currentGradient.colors.length}</span>
          </div>
        </div>
      </div>

      {/* Tips */}
      <Card className="p-3 bg-zinc-900/50 border-zinc-800">
        <div className="text-xs text-zinc-400 space-y-1">
          <p className="font-medium text-zinc-300 mb-2">💡 Tips:</p>
          <p>• Use "Randomize" for completely new gradients</p>
          <p>• Try different styles for various aesthetics</p>
          <p>• Generate variations to refine your gradient</p>
          <p>• Mood-based generation creates themed palettes</p>
        </div>
      </Card>
    </div>
  );
}