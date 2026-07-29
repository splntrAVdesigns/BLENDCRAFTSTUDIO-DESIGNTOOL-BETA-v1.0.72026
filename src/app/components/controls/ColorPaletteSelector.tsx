import { useState } from 'react';
import { COLOR_PALETTES, paletteToColorStops } from '../../utils/colors';
import { getPaletteMetadata } from '../../utils/paletteMetadata';
import { Label } from '../ui/label';
import { ScrollArea } from '../ui/scroll-area';
import { ColorStop } from '../../types/gradient';
import { Button } from '../ui/button';
import { Sparkles, TrendingUp } from 'lucide-react';

interface ColorPaletteSelectorProps {
  onSelectPalette: (colors: ColorStop[]) => void;
}

// Category section metadata
const categorySections = {
  'BASICS': {
    description: 'Foundational palettes for beginners',
    categories: ['Monochrome', 'Pastels', 'Vibrant'],
  },
  'PROFESSIONAL': {
    description: 'Business and corporate use',
    categories: ['Professional', 'Metallic'],
  },
  'NATURE & ORGANIC': {
    description: 'Earth tones and natural inspiration',
    categories: ['Nature', 'Jungle', 'Wellness'],
  },
  'MODERN TRENDS': {
    description: '2026 design aesthetics',
    categories: ['Glassmorphism', 'Dark Mode', 'Y2K Revival', 'Web3/Crypto'],
  },
  'BOLD & ELECTRIC': {
    description: 'High-energy and futuristic',
    categories: ['Bold', 'Techno', 'Future', 'Psychedelic Acid'],
  },
  'COLOR THEORY': {
    description: 'Educational and design fundamentals',
    categories: ['Color Theory: Triadic', 'Color Theory: Analogous', 'Color Theory: Split-Comp'],
  },
  'SPECIALTY': {
    description: 'Industry-specific applications',
    categories: ['AI & Data Viz'],
  },
};

export function ColorPaletteSelector({ onSelectPalette }: ColorPaletteSelectorProps) {
  const [selectedPalette, setSelectedPalette] = useState<ColorStop[] | null>(null);
  
  const paletteCategories = {
    // BASICS - Foundational palettes for beginners
    'Monochrome': ['grays', 'blues', 'reds', 'greens'],
    'Pastels': ['cotton', 'mint', 'lavender', 'peach', 'sky', 'rose', 'sunrise', 'coral'],
    'Vibrant': ['sunset', 'ocean', 'forest', 'purple', 'fire', 'crimson', 'neon', 'tropical'],
    
    // PROFESSIONAL - Business and corporate use
    'Professional': ['corporate', 'elegant', 'minimal', 'slate', 'navy', 'charcoal', 'azure', 'teal'],
    'Metallic': ['gold', 'silver', 'chrome', 'platinum', 'titanium', 'steel', 'iridescent', 'holographic'],
    
    // NATURE & ORGANIC - Earth tones and natural inspiration
    'Nature': ['galaxy', 'bronze', 'copper', 'mudBrown', 'canopyShade', 'autumn', 'moss', 'driftwood'],
    'Jungle': ['deepJungle', 'forestFloor', 'mossyRock', 'earthyVine', 'tropicalGreen', 'jaguar', 'wetFoliage', 'anaconda'],
    'Wellness': ['meditationCalm', 'therapyGreen', 'spaTranquil', 'yogaBalance', 'mindfulnessBlue', 'zenGarden'],
    
    // MODERN TRENDS - 2026 design aesthetics
    'Glassmorphism': ['frostedGlass', 'softNeumorphic', 'translucentLayers', 'blurredDepth', 'glassMorph'],
    'Dark Mode': ['darkVibrant', 'darkProfessional', 'darkPastel', 'oledSafe'],
    'Y2K Revival': ['y2kChrome', 'bubblegumPop', 'earlyInternet', 'flashEra'],
    'Web3/Crypto': ['bitcoinGold', 'ethereumGrad', 'defiBlue', 'nftPrismatic', 'blockchainNet'],
    
    // BOLD & ELECTRIC - High-energy and futuristic
    'Bold': ['cyberpunk', 'electric', 'voltage', 'cosmic', 'aurora', 'spectrum', 'prism', 'kaleidoscope'],
    'Techno': ['neonRave', 'cyberGrid', 'laserShow', 'synthWave', 'technoBlue', 'acidHouse', 'ultraviolet', 'electricPink', 'neonOrange', 'rave', 'strobeLight', 'glowStick'],
    'Future': ['hologram', 'cybernetic', 'quantumBlue', 'neuralNet', 'biotech', 'plasmaCore', 'darkMatter', 'warpDrive', 'xenon', 'android', 'spaceDust'],
    'Psychedelic Acid': ['electricDreams', 'acidRain', 'neonMelt', 'cyberFlux', 'trippySunset', 'laserBeam', 'holographicShift', 'raveLights'],

    // COLOR THEORY - Educational and design fundamentals
    'Color Theory: Triadic': ['primaryTriad', 'secondaryTriad', 'tertiaryTriad', 'warmTriad', 'coolTriad', 'earthTriad'],
    'Color Theory: Analogous': ['coolAnalogous', 'warmAnalogous', 'purpleAnalogous', 'greenAnalogous', 'blueAnalogous', 'redAnalogous'],
    'Color Theory: Split-Comp': ['blueSplitComp', 'redSplitComp', 'greenSplitComp', 'yellowSplitComp'],
    
    // SPECIALTY - Industry-specific applications
    'AI & Data Viz': ['dataHeatmap', 'mlConfidence', 'analyticsDash', 'neuralNetwork', 'predictionCurve', 'dataFlow'],
  };

  // Custom display names for palettes
  const paletteDisplayNames: Record<string, string> = {
    'cosmic': 'Poptart Piper',
    'primaryTriad': 'Primary Triad',
    'secondaryTriad': 'Secondary Triad',
    'tertiaryTriad': 'Tertiary Triad',
    'warmTriad': 'Warm Triad',
    'coolTriad': 'Cool Triad',
    'earthTriad': 'Earth Triad',
    'coolAnalogous': 'Cool Analogous',
    'warmAnalogous': 'Warm Analogous',
    'purpleAnalogous': 'Purple Analogous',
    'greenAnalogous': 'Green Analogous',
    'blueAnalogous': 'Blue Analogous',
    'redAnalogous': 'Red Analogous',
    'blueSplitComp': 'Blue Split-Comp',
    'redSplitComp': 'Red Split-Comp',
    'greenSplitComp': 'Green Split-Comp',
    'yellowSplitComp': 'Yellow Split-Comp',
    'frostedGlass': 'Frosted Glass',
    'softNeumorphic': 'Soft Neumorphic',
    'translucentLayers': 'Translucent Layers',
    'blurredDepth': 'Blurred Depth',
    'glassMorph': 'Glass Morph',
    'dataHeatmap': 'Data Heatmap',
    'mlConfidence': 'ML Confidence',
    'analyticsDash': 'Analytics Dashboard',
    'neuralNetwork': 'Neural Network',
    'predictionCurve': 'Prediction Curve',
    'dataFlow': 'Data Flow',
    'bitcoinGold': 'Bitcoin Gold',
    'ethereumGrad': 'Ethereum',
    'defiBlue': 'DeFi Blue',
    'nftPrismatic': 'NFT Prismatic',
    'blockchainNet': 'Blockchain Network',
    'meditationCalm': 'Meditation Calm',
    'therapyGreen': 'Therapy Green',
    'spaTranquil': 'Spa Tranquil',
    'yogaBalance': 'Yoga Balance',
    'mindfulnessBlue': 'Mindfulness Blue',
    'zenGarden': 'Zen Garden',
    'darkVibrant': 'Dark Vibrant',
    'darkProfessional': 'Dark Professional',
    'darkPastel': 'Dark Pastel',
    'oledSafe': 'OLED Safe',
    'y2kChrome': 'Y2K Chrome',
    'bubblegumPop': 'Bubblegum Pop',
    'earlyInternet': 'Early Internet',
    'flashEra': 'Flash Era',
    'electricDreams': 'Electric Dreams',
    'acidRain': 'Acid Rain',
    'neonMelt': 'Neon Melt',
    'cyberFlux': 'Cyber Flux',
    'trippySunset': 'Trippy Sunset',
    'laserBeam': 'Laser Beam',
    'holographicShift': 'Holographic Shift',
    'raveLights': 'Rave Lights',
  };

  const handleSelectPalette = (colors: ColorStop[]) => {
    setSelectedPalette(colors);
  };

  const handleApplyToCanvas = () => {
    if (selectedPalette) {
      onSelectPalette(selectedPalette);
    }
  };

  const PalettePreview = ({ name, paletteName, colors, isSelected }: { name: string; paletteName: string; colors: string[]; isSelected: boolean }) => {
    // Only apply capitalize class if name doesn't contain spaces (automatic names)
    const hasCustomName = name.includes(' ');
    const metadata = getPaletteMetadata(paletteName);
    const isTrending = metadata?.trending || false;
    
    return (
      <div
        className={`group cursor-pointer rounded-lg overflow-hidden border transition-all relative ${
          isSelected ? 'border-blue-500 ring-2 ring-blue-500/50' : 'border-zinc-800 hover:border-zinc-600'
        }`}
        onClick={() => handleSelectPalette(paletteToColorStops(colors))}
        title={metadata ? `${metadata.description}\nUse: ${metadata.useCase.join(', ')}` : undefined}
      >
        {/* Trending Badge */}
        {isTrending && (
          <div className="absolute top-0 right-0 z-10 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-bl-md px-1 py-0.5">
            <Sparkles className="w-2 h-2 text-white" />
          </div>
        )}
        
        {/* Color Preview - Reduced height to h-4 */}
        <div className="h-4 flex">
          {colors.map((color, index) => (
            <div
              key={index}
              className="flex-1 transition-all group-hover:scale-105"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        
        {/* Name */}
        <div className="p-1 bg-zinc-900">
          <p className={`text-[9px] font-medium text-zinc-200 truncate ${hasCustomName ? '' : 'capitalize'}`}>{name}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="m-[0px] px-[16px] py-[4px]">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">Color Palettes</h3>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            137 palettes • 20 categories • 26 trending
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleApplyToCanvas}
          disabled={!selectedPalette}
          className="bg-gradient-to-r from-[#0066FF] via-[#0099FF] to-[#00CCFF] hover:from-[#0052CC] hover:via-[#0080DD] hover:to-[#00B8E6] !text-white border-none shadow-lg shadow-blue-500/20 font-semibold"
        >
          Apply
        </Button>
      </div>
      
      <ScrollArea className="h-[240px] pr-4 bg-[#262626] p-3 rounded">
        <div className="space-y-5">
          {Object.entries(categorySections).map(([sectionName, sectionData]) => (
            <div key={sectionName} className="space-y-3">
              {/* Section Header */}
              <div className="border-b border-zinc-700 pb-1.5">
                <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  {sectionName}
                </h4>
                <p className="text-[9px] text-zinc-500 mt-0.5">{sectionData.description}</p>
              </div>
              
              {/* Categories in this section */}
              {sectionData.categories.map(category => {
                const paletteNames = paletteCategories[category as keyof typeof paletteCategories];
                if (!paletteNames) return null;
                
                return (
                  <div key={category} className="space-y-2">
                    <Label className="text-xs text-zinc-500">{category}</Label>
                    <div className="grid grid-cols-4 gap-2">
                      {paletteNames.map(paletteName => {
                        const colors = COLOR_PALETTES[paletteName as keyof typeof COLOR_PALETTES];
                        const colorStops = paletteToColorStops(colors);
                        const isSelected = selectedPalette ? 
                          JSON.stringify(selectedPalette.map(s => s.color)) === JSON.stringify(colorStops.map(s => s.color)) 
                          : false;
                        return (
                          <PalettePreview
                            key={paletteName}
                            name={paletteDisplayNames[paletteName] || paletteName}
                            paletteName={paletteName}
                            colors={colors}
                            isSelected={isSelected}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}