import React, { useState } from 'react';
import { Palette, Copy, Check, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Card } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { toast } from 'sonner';
import {
  getAllHarmonies,
  getShades,
  getTints,
  getTones,
  getContrastColor,
  type ColorScheme,
} from '../../utils/colorHarmony';

interface ColorHarmonyPanelProps {
  baseColor: string;
  onColorSelect: (color: string) => void;
  onSchemeApply: (colors: string[]) => void;
}

export function ColorHarmonyPanel({ baseColor, onColorSelect, onSchemeApply }: ColorHarmonyPanelProps) {
  const [copiedColor, setCopiedColor] = useState<string | null>(null);

  const harmonies = getAllHarmonies(baseColor);
  const shades = getShades(baseColor, 5);
  const tints = getTints(baseColor, 5);
  const tones = getTones(baseColor, 5);

  const handleCopyColor = (color: string) => {
    navigator.clipboard.writeText(color);
    setCopiedColor(color);
    toast.success(`Copied ${color}`);
    setTimeout(() => setCopiedColor(null), 2000);
  };

  const handleApplyScheme = (scheme: ColorScheme) => {
    onSchemeApply(scheme.colors);
    toast.success(`Applied ${scheme.name} scheme`);
  };

  return (
    <div className="space-y-4">
      {/* Base Color Display */}
      <Card className="p-3 bg-zinc-900 border-zinc-800">
        <Label className="mb-2 block text-xs text-zinc-400">Base Color</Label>
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded border-2 border-zinc-700 shadow-lg cursor-pointer"
            style={{ backgroundColor: baseColor }}
            onClick={() => handleCopyColor(baseColor)}
          />
          <div className="flex-1">
            <div className="text-sm font-mono mb-1">{baseColor.toUpperCase()}</div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleCopyColor(baseColor)}
              className="h-7 text-xs"
            >
              {copiedColor === baseColor ? (
                <>
                  <Check className="w-3 h-3 mr-1" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 mr-1" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>

      {/* Color Harmonies */}
      <div className="space-y-2">
        <Label className="text-sm">Color Harmonies</Label>
        <ScrollArea className="h-[250px] border border-zinc-800 rounded-lg bg-zinc-950">
          <div className="p-2 space-y-2">
            {harmonies.map((scheme) => (
              <Card key={scheme.name} className="p-2 bg-zinc-900 border-zinc-800">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="text-xs font-medium mb-0.5">{scheme.name}</div>
                    <div className="text-xs text-zinc-400">{scheme.description}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleApplyScheme(scheme)}
                    className="h-6 text-xs px-2"
                  >
                    <Sparkles className="w-3 h-3 mr-1" />
                    Apply
                  </Button>
                </div>

                <div className="flex gap-1 mt-2">
                  {scheme.colors.map((color, index) => (
                    <div
                      key={index}
                      className="relative flex-1 group cursor-pointer"
                      onClick={() => onColorSelect(color)}
                    >
                      <div
                        className="w-full h-12 rounded border border-zinc-700 group-hover:border-zinc-500 transition-colors"
                        style={{ backgroundColor: color }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyColor(color);
                          }}
                          className="h-6 bg-black/50 backdrop-blur-sm"
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                      <div
                        className="text-xs text-center mt-1 font-mono"
                        style={{ color: getContrastColor(color) === '#ffffff' ? '#fff' : '#000' }}
                      >
                        {color.slice(0, 7)}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Shades, Tints, and Tones */}
      <div className="space-y-4">
        {/* Shades */}
        <div>
          <Label className="mb-2 block">Shades (Darker)</Label>
          <div className="flex gap-1">
            {shades.map((color, index) => (
              <div
                key={index}
                className="flex-1 h-10 rounded border border-zinc-700 hover:border-zinc-500 cursor-pointer transition-colors group relative"
                style={{ backgroundColor: color }}
                onClick={() => onColorSelect(color)}
              >
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyColor(color);
                    }}
                    className="h-6 bg-black/50 backdrop-blur-sm"
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tints */}
        <div>
          <Label className="mb-2 block">Tints (Lighter)</Label>
          <div className="flex gap-1">
            {tints.map((color, index) => (
              <div
                key={index}
                className="flex-1 h-10 rounded border border-zinc-700 hover:border-zinc-500 cursor-pointer transition-colors group relative"
                style={{ backgroundColor: color }}
                onClick={() => onColorSelect(color)}
              >
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyColor(color);
                    }}
                    className="h-6 bg-black/50 backdrop-blur-sm"
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tones */}
        <div>
          <Label className="mb-2 block">Tones (Desaturated)</Label>
          <div className="flex gap-1">
            {tones.map((color, index) => (
              <div
                key={index}
                className="flex-1 h-10 rounded border border-zinc-700 hover:border-zinc-500 cursor-pointer transition-colors group relative"
                style={{ backgroundColor: color }}
                onClick={() => onColorSelect(color)}
              >
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyColor(color);
                    }}
                    className="h-6 bg-black/50 backdrop-blur-sm"
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tips */}
      <Card className="p-3 bg-zinc-900/50 border-zinc-800">
        <div className="text-xs text-zinc-400 space-y-1">
          <p className="font-medium text-zinc-300 mb-2">💡 Tips:</p>
          <p>• Click color to add to gradient</p>
          <p>• Click "Apply" to replace all colors</p>
          <p>• Hover + click copy icon to copy hex</p>
          <p>• Use complementary for contrast</p>
        </div>
      </Card>
    </div>
  );
}