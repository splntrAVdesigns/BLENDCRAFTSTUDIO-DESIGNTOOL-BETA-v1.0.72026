import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../ui/accordion';
import { Sparkles, Palette, Wand2, Star } from 'lucide-react';
import { GradientRandomizerPanel } from './GradientRandomizerPanel';
import { ColorHarmonyPanel } from './ColorHarmonyPanel';
import { EnhancedColorPicker } from './EnhancedColorPicker';
import { GradientFavoritesPanel } from './GradientFavoritesPanel';
import { ColorExtractorPanel } from './ColorExtractorPanel';
import { SemanticSearchPanel } from './SemanticSearchPanel';
import { toast } from 'sonner';
import type { GradientConfig, Layer } from '../../types/gradient';

interface AIToolsPanelProps {
  activeLayer: Layer;
  onUpdateLayer: (updates: Partial<Layer>) => void;
}

export function AIToolsPanel({ activeLayer, onUpdateLayer }: AIToolsPanelProps) {
  const [selectedColorIndex, setSelectedColorIndex] = useState(0);
  const [recentColors, setRecentColors] = useState<string[]>([]);

  // Load accordion state from localStorage
  const [openSections, setOpenSections] = useState<string[]>(() => {
    const saved = localStorage.getItem('adv-tools-accordion-state');
    return saved ? JSON.parse(saved) : ['color-selection', 'tools'];
  });

  // Save accordion state to localStorage
  useEffect(() => {
    localStorage.setItem('adv-tools-accordion-state', JSON.stringify(openSections));
  }, [openSections]);

  const gradient = activeLayer.gradient;
  if (!gradient) return null;
  const selectedColor = gradient.colors[selectedColorIndex]?.color || '#5200FF';

  // Save current gradient to favorites
  const handleSaveToFavorites = () => {
    const favorites = JSON.parse(localStorage.getItem('gradient-favorites') || '[]');
    const newFavorite = {
      id: `fav-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: `Gradient ${favorites.length + 1}`,
      gradient,
      timestamp: Date.now(),
    };
    const updatedFavorites = [newFavorite, ...favorites];
    localStorage.setItem('gradient-favorites', JSON.stringify(updatedFavorites));
    
    // Trigger a custom event to notify the favorites panel
    window.dispatchEvent(new CustomEvent('gradientFavoritesUpdated'));
    
    toast.success(`Saved "${newFavorite.name}" to favorites!`);
  };

  const handleGradientGenerated = (gradient: GradientConfig) => {
    onUpdateLayer({
      gradient: {
        ...gradient,
        ...gradient,
      },
    });
  };

  const handleColorSelect = (color: string) => {
    const newColors = [...gradient.colors];
    if (selectedColorIndex < newColors.length) {
      newColors[selectedColorIndex] = { ...newColors[selectedColorIndex], color };
      onUpdateLayer({
        gradient: {
          ...gradient,
          colors: newColors,
        },
      });
    }
    
    // Add to recent colors
    if (!recentColors.includes(color)) {
      setRecentColors([color, ...recentColors.slice(0, 9)]);
    }
  };

  const handleSchemeApply = (colors: string[]) => {
    const newColors = colors.map((color, index) => {
      const existingPosition = gradient.colors[index]?.position || (index / (colors.length - 1));
      return { color, position: existingPosition };
    });

    onUpdateLayer({
      gradient: {
        ...gradient,
        colors: newColors,
      },
    });
  };

  const handleColorChange = (color: string) => {
    handleColorSelect(color);
  };

  const handleAddToRecent = (color: string) => {
    if (!recentColors.includes(color)) {
      setRecentColors([color, ...recentColors.slice(0, 9)]);
    }
  };

  return (
    <div className="p-4">
      <Accordion
        type="multiple"
        value={openSections}
        onValueChange={setOpenSections}
        className="space-y-4"
      >
        {/* Color Stop Selection */}
        <AccordionItem value="color-selection" className="border-none">
          <AccordionTrigger className="py-3 px-4 hover:no-underline">
            <span className="text-sm font-medium text-zinc-100">Color Stop Selection</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2">
            <div className="space-y-2">
              <div className="flex gap-2">
                {gradient.colors.map((stop, index) => (
                  <button
                    key={index}
                    className={`flex-1 h-12 rounded border-2 transition-all ${
                      selectedColorIndex === index
                        ? 'border-[#5200FF] shadow-lg shadow-[#5200FF]/20'
                        : 'border-zinc-700 hover:border-zinc-500'
                    }`}
                    style={{ backgroundColor: stop.color }}
                    onClick={() => setSelectedColorIndex(index)}
                  />
                ))}
              </div>
              <p className="text-xs text-zinc-400 text-center">
                Stop {selectedColorIndex + 1} of {gradient.colors.length}
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Advanced Tools */}
        <AccordionItem value="tools" className="border-none">
          <AccordionTrigger className="py-3 px-4 hover:no-underline">
            <span className="text-sm font-medium text-zinc-100">Smart Tools</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2">
            <Tabs defaultValue="randomizer" className="w-full">
              <TabsList className="grid grid-cols-6 bg-zinc-900 p-1 px-3 mb-4 justify-items-center">
                <TabsTrigger value="randomizer" className="text-[11px] px-2 py-2 data-[state=active]:text-[#51A2FF] border-transparent data-[state=active]:border-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none whitespace-nowrap w-full text-center">
                  Randomize
                </TabsTrigger>
                <TabsTrigger value="picker" className="text-[11px] px-2 py-2 data-[state=active]:text-[#51A2FF] border-transparent data-[state=active]:border-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none whitespace-nowrap w-full text-center">
                  Picker
                </TabsTrigger>
                <TabsTrigger value="extractor" className="text-[11px] px-2 py-2 data-[state=active]:text-[#51A2FF] border-transparent data-[state=active]:border-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none whitespace-nowrap w-full text-center">
                  Extract
                </TabsTrigger>
                <TabsTrigger value="harmony" className="text-[11px] px-2 py-2 data-[state=active]:text-[#51A2FF] border-transparent data-[state=active]:border-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none whitespace-nowrap w-full text-center">
                  Harmony
                </TabsTrigger>
                <TabsTrigger value="search" className="text-[11px] px-2 py-2 data-[state=active]:text-[#51A2FF] border-transparent data-[state=active]:border-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none whitespace-nowrap w-full text-center">
                  Library
                </TabsTrigger>
                <TabsTrigger value="favorites" className="text-[11px] px-2 py-2 data-[state=active]:text-[#51A2FF] border-transparent data-[state=active]:border-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none whitespace-nowrap w-full text-center">
                  Favorites
                </TabsTrigger>
              </TabsList>

              <TabsContent value="randomizer">
                <GradientRandomizerPanel
                  currentGradient={gradient}
                  onGradientGenerated={handleGradientGenerated}
                />
              </TabsContent>

              <TabsContent value="harmony">
                <ColorHarmonyPanel
                  baseColor={selectedColor}
                  onColorSelect={handleColorSelect}
                  onSchemeApply={handleSchemeApply}
                />
              </TabsContent>

              <TabsContent value="picker">
                <EnhancedColorPicker
                  color={selectedColor}
                  onChange={handleColorChange}
                  recentColors={recentColors}
                  onAddToRecent={handleAddToRecent}
                />
              </TabsContent>

              <TabsContent value="extractor">
                <ColorExtractorPanel
                  onColorsExtracted={handleSchemeApply}
                />
              </TabsContent>

              <TabsContent value="search">
                <SemanticSearchPanel
                  onGradientGenerated={handleGradientGenerated}
                />
              </TabsContent>

              <TabsContent value="favorites">
                <GradientFavoritesPanel
                  onGradientGenerated={handleGradientGenerated}
                />
              </TabsContent>
            </Tabs>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
