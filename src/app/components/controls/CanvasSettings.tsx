import React, { useState, useEffect } from 'react';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { SelectWrapper } from '../ui/select-wrapper';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../ui/accordion';
import { Monitor, Instagram, FileImage, Copy, Check, Shield, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { generateCSSFromLayers } from '../../utils/gradientRenderer';
import { RESOLUTION_PRESETS } from '../../utils/resolutions';
import type { CanvasSettings as CanvasSettingsType, Layer } from '../../types/gradient';

interface CanvasSettingsProps {
  settings: CanvasSettingsType;
  onChange: (settings: CanvasSettingsType) => void;
  layers?: Layer[];
  onCommitHistory?: () => void; // 🔥 COMMIT-BASED HISTORY
}

export function CanvasSettings({ settings, onChange, layers = [], onCommitHistory }: CanvasSettingsProps) {
  const [customWidth, setCustomWidth] = useState(settings.width.toString());
  const [customHeight, setCustomHeight] = useState(settings.height.toString());
  const [copiedCSS, setCopiedCSS] = useState(false);

  // Load accordion state from localStorage
  const [openSections, setOpenSections] = useState<string[]>(() => {
    const saved = localStorage.getItem('settings-accordion-state');
    return saved ? JSON.parse(saved) : ['resolution'];
  });

  // Save accordion state to localStorage
  useEffect(() => {
    localStorage.setItem('settings-accordion-state', JSON.stringify(openSections));
  }, [openSections]);

  const updateSettings = (updates: Partial<CanvasSettingsType>) => {
    onChange({ ...settings, ...updates });
    if (onCommitHistory) onCommitHistory(); // 🔥 COMMIT-BASED HISTORY
  };

  const applyCustomDimensions = () => {
    const width = parseInt(customWidth);
    const height = parseInt(customHeight);
    
    if (isNaN(width) || isNaN(height) || width < 1 || height < 1) {
      toast.error('Please enter valid dimensions');
      return;
    }
    
    updateSettings({ width, height });
    toast.success(`Canvas resized to ${width}×${height}`);
  };

  const applyPreset = (width: number, height: number) => {
    updateSettings({ width, height });
    setCustomWidth(width.toString());
    setCustomHeight(height.toString());
    toast.success(`Canvas resized to ${width}×${height}`);
  };

  const categories = {
    standard: RESOLUTION_PRESETS.filter(r => r.category === 'standard'),
    social: RESOLUTION_PRESETS.filter(r => r.category === 'social'),
    print: RESOLUTION_PRESETS.filter(r => r.category === 'print'),
  };

  const copyCSS = () => {
    const css = generateCSSFromLayers(layers);
    navigator.clipboard.writeText(css);
    setCopiedCSS(true);
    toast.success('CSS copied to clipboard!');
    setTimeout(() => setCopiedCSS(false), 2000);
  };

  return (
    <div className="p-4">
      <Accordion
        type="multiple"
        value={openSections}
        onValueChange={setOpenSections}
        className="space-y-4"
      >
        {/* Resolution */}
        <AccordionItem value="resolution" className="border-none">
          <AccordionTrigger className="py-3 px-4 hover:no-underline">
            <span className="text-sm font-medium text-[#51a2ff]">Resolution</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2">
            <div className="space-y-4">
              {/* Current Resolution Display */}
              <div className="p-2.5 rounded-lg border border-[#51a2ff] bg-[#18181b00]">
                <Label className="text-[10px] mb-1 block text-[#51a2ff]">Current</Label>
                <p className="text-lg font-bold text-zinc-100">
                  {settings.width} × {settings.height}
                </p>
                <p className="text-[9px] mt-0.5 text-[#51a2ff]">
                  {(settings.width * settings.height / 1000000).toFixed(2)}MP
                </p>
              </div>

              {/* Preset Resolutions */}
              <Tabs defaultValue="standard" className="w-full">
                <TabsList className="grid w-full grid-cols-3 bg-[#18181b00]">
                  <TabsTrigger value="standard" className="text-xs text-[#51a2ff]">
                    <Monitor className="w-3 h-3 mr-1" />
                    Standard
                  </TabsTrigger>
                  <TabsTrigger value="social" className="text-xs text-[#51a2ff]">
                    <Instagram className="w-3 h-3 mr-1" />
                    Social
                  </TabsTrigger>
                  <TabsTrigger value="print" className="text-xs text-[#51a2ff]">
                    <FileImage className="w-3 h-3 mr-1" />
                    Print
                  </TabsTrigger>
                </TabsList>

                {Object.entries(categories).map(([category, resolutions]) => (
                  <TabsContent key={category} value={category} className="space-y-2 mt-3">
                    {resolutions.map(resolution => {
                      const isActive = settings.width === resolution.width && settings.height === resolution.height;
                      return (
                        <Button
                          key={resolution.name}
                          variant="outline"
                          size="sm"
                          className={`w-full justify-between border-zinc-800 hover:bg-zinc-800 text-xs ${ isActive ? 'border-blue-500 bg-blue-950' : '' } bg-[#262626bf]`}
                          onClick={() => applyPreset(resolution.width, resolution.height)}
                        >
                          <span>{resolution.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-zinc-500">
                              {resolution.width}×{resolution.height}
                            </span>
                            {isActive && <Check className="w-3 h-3 text-blue-500" />}
                          </div>
                        </Button>
                      );
                    })}
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Custom Dimensions */}
        <AccordionItem value="custom" className="border-none">
          <AccordionTrigger className="py-3 px-4 hover:no-underline">
            <span className="text-sm font-medium text-[#51a2ff]">Custom Dimensions</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">Width (px)</Label>
                  <Input
                    type="number"
                    value={customWidth}
                    onChange={(e) => setCustomWidth(e.target.value)}
                    className="bg-zinc-900 border-zinc-800 h-8 text-xs"
                    min={1}
                    max={7680}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">Height (px)</Label>
                  <Input
                    type="number"
                    value={customHeight}
                    onChange={(e) => setCustomHeight(e.target.value)}
                    className="bg-zinc-900 border-zinc-800 h-8 text-xs"
                    min={1}
                    max={4320}
                  />
                </div>
              </div>
              <Button
                onClick={applyCustomDimensions}
                size="sm"
                className="w-full bg-gradient-to-r from-[#0066FF] via-[#0099FF] to-[#00CCFF] hover:from-[#0052CC] hover:via-[#0080DD] hover:to-[#00B8E6] text-white border-none shadow-lg shadow-blue-500/20"
              >
                Apply Custom Size
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Canvas Scale — Media Layer System (Stage 1).
            Scales the CURRENT canvas up/down preserving aspect ratio,
            so any ratio preset can be sized to need with one tap. */}
        <AccordionItem value="canvas-scale" className="border-none">
          <AccordionTrigger className="py-3 px-4 hover:no-underline">
            <span className="text-sm font-medium text-[#51a2ff]">Canvas Scale</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2">
            <div className="space-y-3">
              <p className="text-[10px] text-zinc-500">
                Scale the current {settings.width}×{settings.height} canvas — aspect ratio is preserved.
              </p>
              <div className="grid grid-cols-5 gap-1.5">
                {[0.5, 0.75, 1.25, 1.5, 2].map((factor) => {
                  // Clamp within renderer-safe bounds, round to even pixels
                  // (video encoders require even dimensions).
                  const even = (v: number) => Math.round(v / 2) * 2;
                  const idealW = even(settings.width * factor);
                  const idealH = even(settings.height * factor);
                  const nextW = Math.max(64, Math.min(7680, idealW));
                  const nextH = Math.max(64, Math.min(4320, idealH));
                  const clamped = nextW !== idealW || nextH !== idealH;
                  return (
                    <Button
                      key={factor}
                      variant="outline"
                      size="sm"
                      className="border-zinc-700 bg-[#262626bf] hover:bg-zinc-800 text-[10px] text-zinc-300 px-1"
                      title={`${nextW}×${nextH}${clamped ? ' (clamped)' : ''}`}
                      onClick={() => {
                        updateSettings({ width: nextW, height: nextH });
                        setCustomWidth(nextW.toString());
                        setCustomHeight(nextH.toString());
                        toast.success(`Canvas scaled ×${factor} → ${nextW}×${nextH}`);
                      }}
                    >
                      ×{factor}
                    </Button>
                  );
                })}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Appearance */}
        <AccordionItem value="appearance" className="border-none">
          <AccordionTrigger className="py-3 px-4 hover:no-underline">
            <span className="text-sm font-medium text-[#51a2ff]">Appearance</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-2">
            <div className="space-y-2">
              <Label className="text-xs text-zinc-400">Background Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={settings.backgroundColor}
                  onChange={(e) => updateSettings({ backgroundColor: e.target.value })}
                  className="w-10 h-10 rounded cursor-pointer bg-transparent"
                />
                <div className="flex-1">
                  <Input
                    type="text"
                    value={settings.backgroundColor}
                    onChange={(e) => updateSettings({ backgroundColor: e.target.value })}
                    className="bg-zinc-900 border-zinc-800 font-mono text-xs h-8"
                  />
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Active Colors */}
        {layers.length > 0 && (
          <AccordionItem value="active-colors" className="border-none">
            <AccordionTrigger className="py-3 px-4 hover:no-underline">
              <span className="text-sm font-medium text-[#51a2ff]">Active Colors</span>
            </AccordionTrigger>
            <AccordionContent className="pb-4 pt-2">
              <div className="space-y-3">
                {layers
                  .filter(layer => layer.visible && layer.gradient)
                  .map(layer => (
                    <div key={layer.id} className="space-y-2">
                      <p className="text-[10px] text-zinc-500 font-medium">{layer.name}</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {layer.gradient!.colors.map((color, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-1.5 p-1.5 rounded bg-zinc-900 border border-zinc-800"
                          >
                            <div
                              className="w-6 h-6 rounded border border-zinc-700 flex-shrink-0"
                              style={{ backgroundColor: color.color }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-mono text-zinc-300 truncate">
                                {color.color.toUpperCase()}
                              </p>
                              <p className="text-[9px] text-zinc-500">
                                {(color.position * 100).toFixed(0)}%
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Export */}
        {layers.length > 0 && (
          <AccordionItem value="export" className="border-none">
            <AccordionTrigger className="py-3 px-4 hover:no-underline">
              <span className="text-sm font-medium text-[#51a2ff]">Export CSS</span>
            </AccordionTrigger>
            <AccordionContent className="pb-4 pt-2">
              <Button
                onClick={copyCSS}
                size="sm"
                className={`w-full bg-gradient-to-r from-[#0066FF] via-[#0099FF] to-[#00CCFF] hover:from-[#0052CC] hover:via-[#0080DD] hover:to-[#00B8E6] text-white border-none shadow-lg shadow-blue-500/20 ${
                  copiedCSS ? 'from-green-600 via-green-600 to-green-600 hover:from-green-700 hover:via-green-700 hover:to-green-700' : ''
                }`}
              >
                <Copy className="w-3 h-3 mr-1" />
                {copiedCSS ? 'Copied!' : 'Copy CSS'}
              </Button>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  );
}