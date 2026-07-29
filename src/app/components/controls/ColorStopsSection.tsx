import { Button } from '../ui/button';
import { Slider } from '../ui/slider';
import { ConditionalTooltip } from '../ui/ConditionalTooltip';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../ui/accordion';
import { Plus, Trash2, ArrowLeftRight } from 'lucide-react';
import { ColorStop } from '../../types/gradient';
import { useState, useEffect } from 'react';

interface ColorStopsSectionProps {
  colors: ColorStop[];
  onColorsChange: (colors: ColorStop[]) => void;
  onCommitHistory?: () => void; // 🔥 COMMIT-BASED HISTORY
}

export function ColorStopsSection({ colors, onColorsChange, onCommitHistory }: ColorStopsSectionProps) {
  // Load accordion state from localStorage
  const [openSections, setOpenSections] = useState<string[]>(() => {
    const saved = localStorage.getItem('color-stops-accordion-state');
    return saved ? JSON.parse(saved) : []; // Default to collapsed
  });

  // Save accordion state to localStorage
  useEffect(() => {
    localStorage.setItem('color-stops-accordion-state', JSON.stringify(openSections));
  }, [openSections]);

  const updateColor = (index: number, updates: Partial<ColorStop>) => {
    const newColors = [...colors];
    newColors[index] = { ...newColors[index], ...updates };
    // Emit the updated array as-is. GradientCanvas sorts before writing to GPU
    // so unsorted arrays during live drag are handled correctly.
    onColorsChange(newColors);
    if (onCommitHistory) onCommitHistory(); // 🔥 COMMIT-BASED HISTORY
  };

  const addColorStop = () => {
    const newColors = [...colors];
    // Use the MAX position across all stops (not the last array element, which may
    // be out of order after dragging). New stop is placed halfway between max and 1.0.
    const maxPos = newColors.length > 0
      ? Math.max(...newColors.map(s => s.position))
      : 0;
    const newPosition = maxPos < 1 ? (maxPos + 1) / 2 : Math.max(0, maxPos - 0.05);
    // Pick a mid-range color from existing stops rather than a hard-coded magenta
    const midStop = newColors[Math.floor(newColors.length / 2)];
    newColors.push({ color: midStop?.color ?? '#8B5CF6', position: newPosition });
    onColorsChange(newColors);
    if (onCommitHistory) onCommitHistory(); // 🔥 COMMIT-BASED HISTORY
  };

  const removeColorStop = (index: number) => {
    if (colors.length <= 2) return; // Keep at least 2 colors
    const newColors = colors.filter((_, i) => i !== index);
    onColorsChange(newColors);
    if (onCommitHistory) onCommitHistory(); // 🔥 COMMIT-BASED HISTORY
  };

  const reverseGradient = () => {
    const reversed = [...colors].reverse().map((stop, index, array) => ({
      ...stop,
      position: 1 - array[array.length - 1 - index].position
    }));
    onColorsChange(reversed);
    if (onCommitHistory) onCommitHistory(); // 🔥 COMMIT-BASED HISTORY
  };

  return (
    <div className="px-[16px] py-[2px]">
      <Accordion
        type="multiple"
        value={openSections}
        onValueChange={setOpenSections}
      >
        <AccordionItem value="colors" className="border-none">
          <AccordionTrigger className="py-3 px-4 hover:no-underline">
            <span className="text-sm font-medium text-zinc-100">Color Stops ({colors.length})</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addColorStop}
                  className="flex-1 h-8 bg-zinc-900 border-zinc-700 hover:bg-zinc-800 text-xs"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add Color Stop
                </Button>
                <ConditionalTooltip content="Reverse the order of all color stops">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={reverseGradient}
                    className="h-8 px-3 bg-zinc-900 border-zinc-700 hover:bg-zinc-800 text-xs"
                  >
                    <ArrowLeftRight className="w-3 h-3" />
                  </Button>
                </ConditionalTooltip>
              </div>
              
              {colors.map((stop, index) => (
                <div key={index} className="flex items-center gap-2 p-1.5 bg-zinc-900 rounded-lg border border-zinc-800">
                  <input
                    type="color"
                    value={stop.color}
                    onChange={(e) => updateColor(index, { color: e.target.value })}
                    className="w-8 h-8 rounded cursor-pointer bg-transparent"
                  />
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-500 w-14">Position:</span>
                      <Slider
                        value={[stop.position * 100]}
                        onValueChange={([value]) => updateColor(index, { position: value / 100 })}
                        min={0}
                        max={100}
                        step={1}
                        className="flex-1"
                      />
                      <span className="text-[10px] text-zinc-400 w-10 text-right">{Math.round(stop.position * 100)}%</span>
                    </div>
                  </div>
                  {colors.length > 2 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeColorStop(index)}
                      className="h-6 w-6 p-0 hover:bg-red-950 hover:text-red-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}