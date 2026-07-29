import React, { useState, useRef } from 'react';
import { Upload, Download, Sparkles, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { validateUploadFile, validateBitmapDimensions } from '../../utils/uploadValidation';

interface ColorExtractorPanelProps {
  onColorsExtracted: (colors: string[]) => void;
}

export function ColorExtractorPanel({ onColorsExtracted }: ColorExtractorPanelProps) {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [extractedColors, setExtractedColors] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [colorCount, setColorCount] = useState<number>(5);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Color quantization using median cut algorithm
  const extractColorsFromImage = (imageData: ImageData, numColors: number): string[] => {
    const pixels: [number, number, number][] = [];
    
    // Sample pixels (every 10th pixel for performance)
    for (let i = 0; i < imageData.data.length; i += 40) {
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];
      const a = imageData.data[i + 3];
      
      // Skip transparent pixels
      if (a > 128) {
        pixels.push([r, g, b]);
      }
    }

    if (pixels.length === 0) return ['#000000'];

    // Median cut algorithm
    const medianCut = (pixels: [number, number, number][], depth: number): string[] => {
      if (depth === 0 || pixels.length === 0) {
        // Calculate average color
        const avg = pixels.reduce(
          (acc, pixel) => [acc[0] + pixel[0], acc[1] + pixel[1], acc[2] + pixel[2]],
          [0, 0, 0]
        );
        const r = Math.round(avg[0] / pixels.length);
        const g = Math.round(avg[1] / pixels.length);
        const b = Math.round(avg[2] / pixels.length);
        return [`#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`];
      }

      // Find the channel with the greatest range
      const ranges = [0, 1, 2].map((channel) => {
        const values = pixels.map((p) => p[channel]);
        return Math.max(...values) - Math.min(...values);
      });
      const channelToSplit = ranges.indexOf(Math.max(...ranges));

      // Sort by that channel
      pixels.sort((a, b) => a[channelToSplit] - b[channelToSplit]);

      // Split in half
      const mid = Math.floor(pixels.length / 2);
      const left = pixels.slice(0, mid);
      const right = pixels.slice(mid);

      return [...medianCut(left, depth - 1), ...medianCut(right, depth - 1)];
    };

    const depth = Math.ceil(Math.log2(numColors));
    let colors = medianCut([...pixels], depth);
    
    // Sort by luminance for better visual ordering
    colors.sort((a, b) => {
      const getLuminance = (hex: string) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return 0.299 * r + 0.587 * g + 0.114 * b;
      };
      return getLuminance(b) - getLuminance(a);
    });

    return colors.slice(0, numColors);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileValidation = validateUploadFile(file, 'color-image');
    if (!fileValidation.ok) {
      toast.error(fileValidation.error || 'Please upload a valid image file');
      event.target.value = '';
      return;
    }

    const dimensionValidation = await validateBitmapDimensions(file);
    if (!dimensionValidation.ok) {
      toast.error(dimensionValidation.error || 'Invalid image dimensions');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        setImagePreview(e.target?.result as string);
        processImage(img);
      };
      img.onerror = () => toast.error('Unable to load image for color extraction');
      img.src = e.target?.result as string;
    };
    reader.onerror = () => toast.error('Unable to read image file');
    reader.readAsDataURL(file);
  };

  const processImage = (img: HTMLImageElement) => {
    setIsProcessing(true);

    try {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      // Set canvas size (max 400px for performance)
      const maxSize = 400;
      const scale = Math.min(maxSize / img.width, maxSize / img.height);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      // Draw image
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Get image data
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Extract colors
      const colors = extractColorsFromImage(imageData, colorCount);
      setExtractedColors(colors);

      toast.success(`Extracted ${colors.length} colors from image!`);
    } catch (error) {
      console.error('Error processing image:', error);
      toast.error('Failed to process image');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyColors = () => {
    if (extractedColors.length === 0) {
      toast.error('No colors to apply');
      return;
    }
    onColorsExtracted(extractedColors);
    toast.success('Colors applied to gradient!');
  };

  const handleCopyColor = (color: string) => {
    navigator.clipboard.writeText(color);
    toast.success(`Copied ${color}`);
  };

  const handleColorCountChange = (newCount: number) => {
    setColorCount(newCount);
    
    // Re-process if we have an image
    if (imagePreview && canvasRef.current) {
      const img = new Image();
      img.onload = () => processImage(img);
      img.src = imagePreview;
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload Section */}
      <div className="space-y-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          className="hidden"
        />
        
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
          className="w-full px-4 py-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm font-medium text-zinc-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload className="w-4 h-4" />
          {imagePreview ? 'Change Image' : 'Upload Image'}
        </button>

        {/* Color Count Slider */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-xs font-medium text-zinc-300">Colors to Extract</label>
            <span className="text-xs text-zinc-400">{colorCount}</span>
          </div>
          <input
            type="range"
            min="2"
            max="12"
            step="1"
            value={colorCount}
            onChange={(e) => handleColorCountChange(parseInt(e.target.value))}
            className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #51A2FF 0%, #51A2FF ${((colorCount - 2) / 10) * 100}%, #27272a ${((colorCount - 2) / 10) * 100}%, #27272a 100%)`
            }}
          />
        </div>
      </div>

      {/* Image Preview */}
      {imagePreview && (
        <div className="relative rounded-lg overflow-hidden border border-zinc-700 bg-zinc-900">
          <img
            src={imagePreview}
            alt="Preview"
            className="w-full h-auto max-h-48 object-contain"
          />
          {isProcessing && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-[#51A2FF] animate-spin" />
            </div>
          )}
        </div>
      )}

      {/* Hidden Canvas for Processing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Extracted Colors */}
      {extractedColors.length > 0 && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h4 className="text-xs font-medium text-zinc-300">Extracted Palette</h4>
            <button
              onClick={handleApplyColors}
              className="px-3 py-1.5 bg-[#51A2FF] hover:bg-[#4192EF] text-white text-xs font-medium rounded transition-colors flex items-center gap-1.5"
            >
              <Download className="w-3 h-3" />
              Apply to Gradient
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {extractedColors.map((color, index) => (
              <div
                key={index}
                className="group relative h-16 rounded border border-zinc-700 overflow-hidden cursor-pointer hover:border-[#51A2FF] transition-colors"
                style={{ backgroundColor: color }}
                onClick={() => handleCopyColor(color)}
              >
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-2">
                  <span className="text-xs font-mono text-white">{color}</span>
                  <Copy className="w-3 h-3 text-white" />
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-zinc-500 text-center">
            Click any color to copy its hex code
          </p>
        </div>
      )}

      {/* Empty State */}
      {!imagePreview && (
        <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
          <Upload className="w-8 h-8 text-zinc-600" />
          <p className="text-sm text-zinc-400">Upload an image to extract colors</p>
          <p className="text-xs text-zinc-600">Supports JPG, PNG, WebP, and more</p>
        </div>
      )}
    </div>
  );
}