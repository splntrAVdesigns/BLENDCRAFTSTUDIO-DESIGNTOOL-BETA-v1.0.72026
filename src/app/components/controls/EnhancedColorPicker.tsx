import React, { useState, useEffect } from 'react';
import { Pipette, Palette, History, Eye, EyeOff } from 'lucide-react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Card } from '../ui/card';
import { Slider } from '../ui/slider';
import {
  hexToHsl,
  hslToHex,
  hexToRgb,
  rgbToHex,
  getContrastColor,
  type HSL,
  type RGB,
} from '../../utils/colorHarmony';

interface EnhancedColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  showAlpha?: boolean;
  recentColors?: string[];
  onAddToRecent?: (color: string) => void;
}

export function EnhancedColorPicker({
  color,
  onChange,
  showAlpha = false,
  recentColors = [],
  onAddToRecent,
}: EnhancedColorPickerProps) {
  const [hsl, setHsl] = useState<HSL>(hexToHsl(color));
  const [rgb, setRgb] = useState<RGB>(hexToRgb(color));
  const [hexInput, setHexInput] = useState(color);
  const [showEyeDropper, setShowEyeDropper] = useState(false);

  // Check if EyeDropper API is supported
  useEffect(() => {
    setShowEyeDropper('EyeDropper' in window);
  }, []);

  // Sync when external color changes
  useEffect(() => {
    setHsl(hexToHsl(color));
    setRgb(hexToRgb(color));
    setHexInput(color);
  }, [color]);

  const handleHslChange = (field: keyof HSL, value: number) => {
    const newHsl = { ...hsl, [field]: value };
    setHsl(newHsl);
    const newHex = hslToHex(newHsl);
    onChange(newHex);
    onAddToRecent?.(newHex);
  };

  const handleRgbChange = (field: keyof RGB, value: number) => {
    const newRgb = { ...rgb, [field]: value };
    setRgb(newRgb);
    const newHex = rgbToHex(newRgb);
    onChange(newHex);
    onAddToRecent?.(newHex);
  };

  const handleHexChange = (value: string) => {
    setHexInput(value);
    if (/^#[0-9A-F]{6}$/i.test(value)) {
      onChange(value);
      setHsl(hexToHsl(value));
      setRgb(hexToRgb(value));
      onAddToRecent?.(value);
    }
  };

  const handleEyeDropper = async () => {
    if (!('EyeDropper' in window)) {
      return;
    }

    try {
      // @ts-ignore - EyeDropper is not yet in TypeScript definitions
      const eyeDropper = new EyeDropper();
      const result = await eyeDropper.open();
      if (result.sRGBHex) {
        handleHexChange(result.sRGBHex);
      }
    } catch (error) {
      console.error('EyeDropper error:', error);
    }
  };

  const presetColors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52BE80',
    '#5200FF', '#00D9FF', '#FF0080', '#00FF87', '#FFD700',
  ];

  return (
    <div className="space-y-4">
      {/* Color Preview & Hex Input */}
      <div className="flex items-center gap-3">
        <div
          className="w-16 h-16 rounded-lg border-2 border-zinc-700 shadow-lg cursor-pointer"
          style={{ backgroundColor: color }}
          onClick={() => document.getElementById('color-input')?.click()}
        />
        <div className="flex-1 space-y-2">
          <Input
            id="hex-input"
            value={hexInput}
            onChange={(e) => handleHexChange(e.target.value.toUpperCase())}
            placeholder="#000000"
            className="font-mono"
          />
          {showEyeDropper && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleEyeDropper}
              className="w-full"
            >
              <Pipette className="w-3 h-3 mr-2" />
              Pick from Screen
            </Button>
          )}
        </div>
      </div>

      {/* Hidden native color input for fallback */}
      <input
        id="color-input"
        type="color"
        value={color}
        onChange={(e) => handleHexChange(e.target.value)}
        className="hidden"
      />

      {/* Color Adjustment Tabs */}
      <Tabs defaultValue="hsl" className="w-full">
        <TabsList className="w-full grid grid-cols-3 bg-zinc-900">
          <TabsTrigger value="hsl" className="text-xs">HSL</TabsTrigger>
          <TabsTrigger value="rgb" className="text-xs">RGB</TabsTrigger>
          <TabsTrigger value="presets" className="text-xs">Presets</TabsTrigger>
        </TabsList>

        {/* HSL Controls */}
        <TabsContent value="hsl" className="space-y-4 mt-4">
          {/* Hue */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Hue</Label>
              <span className="text-xs text-zinc-400">{hsl.h}°</span>
            </div>
            <Slider
              value={[hsl.h]}
              onValueChange={([v]) => handleHslChange('h', v)}
              min={0}
              max={360}
              step={1}
              className="[&_[role=slider]]:bg-white"
            />
            <div
              className="h-3 rounded"
              style={{
                background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
              }}
            />
          </div>

          {/* Saturation */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Saturation</Label>
              <span className="text-xs text-zinc-400">{hsl.s}%</span>
            </div>
            <Slider
              value={[hsl.s]}
              onValueChange={([v]) => handleHslChange('s', v)}
              min={0}
              max={100}
              step={1}
            />
            <div
              className="h-3 rounded"
              style={{
                background: `linear-gradient(to right, ${hslToHex({ h: hsl.h, s: 0, l: hsl.l })}, ${hslToHex({ h: hsl.h, s: 100, l: hsl.l })})`,
              }}
            />
          </div>

          {/* Lightness */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Lightness</Label>
              <span className="text-xs text-zinc-400">{hsl.l}%</span>
            </div>
            <Slider
              value={[hsl.l]}
              onValueChange={([v]) => handleHslChange('l', v)}
              min={0}
              max={100}
              step={1}
            />
            <div
              className="h-3 rounded"
              style={{
                background: `linear-gradient(to right, #000000, ${hslToHex({ h: hsl.h, s: hsl.s, l: 50 })}, #ffffff)`,
              }}
            />
          </div>
        </TabsContent>

        {/* RGB Controls */}
        <TabsContent value="rgb" className="space-y-4 mt-4">
          {/* Red */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Red</Label>
              <span className="text-xs text-zinc-400">{rgb.r}</span>
            </div>
            <Slider
              value={[rgb.r]}
              onValueChange={([v]) => handleRgbChange('r', v)}
              min={0}
              max={255}
              step={1}
            />
            <div
              className="h-3 rounded"
              style={{
                background: `linear-gradient(to right, rgb(0, ${rgb.g}, ${rgb.b}), rgb(255, ${rgb.g}, ${rgb.b}))`,
              }}
            />
          </div>

          {/* Green */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Green</Label>
              <span className="text-xs text-zinc-400">{rgb.g}</span>
            </div>
            <Slider
              value={[rgb.g]}
              onValueChange={([v]) => handleRgbChange('g', v)}
              min={0}
              max={255}
              step={1}
            />
            <div
              className="h-3 rounded"
              style={{
                background: `linear-gradient(to right, rgb(${rgb.r}, 0, ${rgb.b}), rgb(${rgb.r}, 255, ${rgb.b}))`,
              }}
            />
          </div>

          {/* Blue */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Blue</Label>
              <span className="text-xs text-zinc-400">{rgb.b}</span>
            </div>
            <Slider
              value={[rgb.b]}
              onValueChange={([v]) => handleRgbChange('b', v)}
              min={0}
              max={255}
              step={1}
            />
            <div
              className="h-3 rounded"
              style={{
                background: `linear-gradient(to right, rgb(${rgb.r}, ${rgb.g}, 0), rgb(${rgb.r}, ${rgb.g}, 255))`,
              }}
            />
          </div>
        </TabsContent>

        {/* Preset Colors */}
        <TabsContent value="presets" className="mt-4">
          <div className="space-y-3">
            {/* Preset Colors Grid */}
            <div>
              <Label className="mb-2 block">Preset Colors</Label>
              <div className="grid grid-cols-5 gap-2">
                {presetColors.map((presetColor, index) => (
                  <button
                    key={index}
                    className="w-full h-10 rounded border-2 border-zinc-700 hover:border-zinc-500 transition-colors"
                    style={{ backgroundColor: presetColor }}
                    onClick={() => handleHexChange(presetColor)}
                  />
                ))}
              </div>
            </div>

            {/* Recent Colors */}
            {recentColors.length > 0 && (
              <div>
                <Label className="mb-2 block flex items-center gap-2">
                  <History className="w-3 h-3" />
                  Recent Colors
                </Label>
                <div className="grid grid-cols-5 gap-2">
                  {recentColors.slice(0, 10).map((recentColor, index) => (
                    <button
                      key={index}
                      className="w-full h-10 rounded border-2 border-zinc-700 hover:border-zinc-500 transition-colors"
                      style={{ backgroundColor: recentColor }}
                      onClick={() => handleHexChange(recentColor)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Color Info */}
      <Card className="p-3 bg-zinc-900 border-zinc-800">
        <div className="text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-zinc-400">Hex:</span>
            <span className="font-mono">{color.toUpperCase()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">RGB:</span>
            <span className="font-mono">
              {rgb.r}, {rgb.g}, {rgb.b}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">HSL:</span>
            <span className="font-mono">
              {hsl.h}°, {hsl.s}%, {hsl.l}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Contrast:</span>
            <span
              className="font-mono"
              style={{ color: getContrastColor(color) }}
            >
              {getContrastColor(color)}
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
