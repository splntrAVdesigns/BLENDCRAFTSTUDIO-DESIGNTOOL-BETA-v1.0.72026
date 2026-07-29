import React, { useState, useMemo } from 'react';
import { Search, Sparkles, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import type { GradientConfig } from '../../types/gradient';

interface SemanticSearchPanelProps {
  onGradientGenerated: (gradient: GradientConfig) => void;
}

interface GradientPreset {
  keywords: string[];
  name: string;
  gradient: {
    type: 'linear' | 'radial' | 'conic';
    angle?: number;
    colors: { color: string; position: number }[];
  };
}

// Comprehensive gradient preset library — keyword-searchable
// Note: search is keyword-based matching, not AI/embedding-based semantic search.
const GRADIENT_PRESETS: GradientPreset[] = [
  // Ocean & Water themes
  {
    keywords: ['ocean', 'sea', 'water', 'marine', 'aqua', 'deep sea'],
    name: 'Deep Ocean',
    gradient: {
      type: 'linear',
      angle: 180,
      colors: [
        { color: '#001f3f', position: 0 },
        { color: '#003d7a', position: 0.3 },
        { color: '#0074D9', position: 0.7 },
        { color: '#7FDBFF', position: 1 },
      ],
    },
  },
  {
    keywords: ['ocean sunset', 'sunset', 'dusk', 'twilight', 'evening'],
    name: 'Ocean Sunset',
    gradient: {
      type: 'linear',
      angle: 180,
      colors: [
        { color: '#FF6B6B', position: 0 },
        { color: '#FF8E53', position: 0.3 },
        { color: '#FFA07A', position: 0.5 },
        { color: '#4ECDC4', position: 0.8 },
        { color: '#1A535C', position: 1 },
      ],
    },
  },
  {
    keywords: ['tropical', 'beach', 'paradise', 'caribbean'],
    name: 'Tropical Waters',
    gradient: {
      type: 'linear',
      angle: 135,
      colors: [
        { color: '#006994', position: 0 },
        { color: '#00C9FF', position: 0.35 },
        { color: '#00D4BD', position: 0.7 },
        { color: '#7FFFD4', position: 1 },
      ],
    },
  },
  
  // Sky & Nature
  {
    keywords: ['sky', 'clouds', 'atmosphere', 'air', 'heaven'],
    name: 'Clear Sky',
    gradient: {
      type: 'linear',
      angle: 180,
      colors: [
        { color: '#87CEEB', position: 0 },
        { color: '#5DADE2', position: 0.35 },
        { color: '#3498DB', position: 0.7 },
        { color: '#2980B9', position: 1 },
      ],
    },
  },
  {
    keywords: ['sunrise', 'dawn', 'morning', 'daybreak'],
    name: 'Golden Sunrise',
    gradient: {
      type: 'linear',
      angle: 0,
      colors: [
        { color: '#FFE000', position: 0 },
        { color: '#FF9A00', position: 0.4 },
        { color: '#FF6B9D', position: 0.7 },
        { color: '#C471F5', position: 1 },
      ],
    },
  },
  {
    keywords: ['forest', 'nature', 'woods', 'green', 'jungle'],
    name: 'Forest Canopy',
    gradient: {
      type: 'linear',
      angle: 135,
      colors: [
        { color: '#0F3D0F', position: 0 },
        { color: '#1A5E1A', position: 0.35 },
        { color: '#2D7D32', position: 0.7 },
        { color: '#4A9B4A', position: 1 },
      ],
    },
  },
  {
    keywords: ['autumn', 'fall', 'leaves', 'harvest'],
    name: 'Autumn Leaves',
    gradient: {
      type: 'linear',
      angle: 45,
      colors: [
        { color: '#8B0000', position: 0 },
        { color: '#D2691E', position: 0.4 },
        { color: '#FF8C00', position: 0.7 },
        { color: '#FFD700', position: 1 },
      ],
    },
  },
  
  // Neon & Cyberpunk
  {
    keywords: ['neon', 'cyberpunk', 'cyber', 'futuristic', 'sci-fi', 'tech'],
    name: 'Neon Cyberpunk',
    gradient: {
      type: 'linear',
      angle: 135,
      colors: [
        { color: '#FF006E', position: 0 },
        { color: '#FF4D00', position: 0.25 },
        { color: '#FFAA00', position: 0.5 },
        { color: '#00F5FF', position: 0.75 },
        { color: '#B967FF', position: 1 },
      ],
    },
  },
  {
    keywords: ['synthwave', 'retrowave', 'vaporwave', '80s', 'retro'],
    name: 'Synthwave',
    gradient: {
      type: 'linear',
      angle: 180,
      colors: [
        { color: '#2E1E3D', position: 0 },
        { color: '#833AB4', position: 0.4 },
        { color: '#FD1D1D', position: 0.7 },
        { color: '#FCB045', position: 1 },
      ],
    },
  },
  {
    keywords: ['matrix', 'digital', 'code', 'hacker', 'terminal'],
    name: 'Digital Matrix',
    gradient: {
      type: 'linear',
      angle: 180,
      colors: [
        { color: '#000000', position: 0 },
        { color: '#003B00', position: 0.5 },
        { color: '#00FF41', position: 1 },
      ],
    },
  },
  
  // Corporate & Professional
  {
    keywords: ['corporate', 'business', 'professional', 'office', 'blue'],
    name: 'Corporate Blue',
    gradient: {
      type: 'linear',
      angle: 135,
      colors: [
        { color: '#1E3A8A', position: 0 },
        { color: '#3B82F6', position: 0.5 },
        { color: '#60A5FA', position: 1 },
      ],
    },
  },
  {
    keywords: ['trust', 'reliable', 'stable', 'confident'],
    name: 'Trust & Stability',
    gradient: {
      type: 'linear',
      angle: 90,
      colors: [
        { color: '#2C3E50', position: 0 },
        { color: '#3498DB', position: 0.5 },
        { color: '#2980B9', position: 1 },
      ],
    },
  },
  {
    keywords: ['luxury', 'premium', 'gold', 'elegant', 'sophisticated'],
    name: 'Luxury Gold',
    gradient: {
      type: 'linear',
      angle: 135,
      colors: [
        { color: '#BF953F', position: 0 },
        { color: '#FCF6BA', position: 0.3 },
        { color: '#B38728', position: 0.6 },
        { color: '#FBF5B7', position: 0.8 },
        { color: '#AA771C', position: 1 },
      ],
    },
  },
  
  // Fire & Energy
  {
    keywords: ['fire', 'flame', 'burning', 'hot', 'heat'],
    name: 'Burning Fire',
    gradient: {
      type: 'linear',
      angle: 0,
      colors: [
        { color: '#FF0000', position: 0 },
        { color: '#FF4500', position: 0.3 },
        { color: '#FFA500', position: 0.6 },
        { color: '#FFD700', position: 1 },
      ],
    },
  },
  {
    keywords: ['energy', 'power', 'vibrant', 'electric', 'dynamic'],
    name: 'Electric Energy',
    gradient: {
      type: 'radial',
      colors: [
        { color: '#FFFF00', position: 0 },
        { color: '#FFD700', position: 0.3 },
        { color: '#FFA500', position: 0.6 },
        { color: '#FF4500', position: 1 },
      ],
    },
  },
  
  // Space & Cosmic
  {
    keywords: ['space', 'galaxy', 'cosmos', 'universe', 'nebula', 'stars'],
    name: 'Cosmic Galaxy',
    gradient: {
      type: 'linear',
      angle: 135,
      colors: [
        { color: '#000000', position: 0 },
        { color: '#1A0033', position: 0.2 },
        { color: '#4A148C', position: 0.5 },
        { color: '#7B1FA2', position: 0.7 },
        { color: '#FF1744', position: 1 },
      ],
    },
  },
  {
    keywords: ['aurora', 'northern lights', 'polar', 'mystical'],
    name: 'Aurora Borealis',
    gradient: {
      type: 'linear',
      angle: 90,
      colors: [
        { color: '#001F3F', position: 0 },
        { color: '#00FF88', position: 0.25 },
        { color: '#00FFCC', position: 0.5 },
        { color: '#6B5ACD', position: 0.75 },
        { color: '#4169E1', position: 1 },
      ],
    },
  },
  
  // Pastels & Soft
  {
    keywords: ['pastel', 'soft', 'gentle', 'light', 'subtle', 'delicate'],
    name: 'Soft Pastels',
    gradient: {
      type: 'linear',
      angle: 135,
      colors: [
        { color: '#FFB6C1', position: 0 },
        { color: '#E6E6FA', position: 0.5 },
        { color: '#B0E0E6', position: 1 },
      ],
    },
  },
  {
    keywords: ['cotton candy', 'candy', 'sweet', 'bubblegum'],
    name: 'Cotton Candy',
    gradient: {
      type: 'linear',
      angle: 45,
      colors: [
        { color: '#FFB5E8', position: 0 },
        { color: '#FF9CEE', position: 0.5 },
        { color: '#B28DFF', position: 1 },
      ],
    },
  },
  
  // Dark & Dramatic
  {
    keywords: ['dark', 'black', 'night', 'midnight', 'shadow'],
    name: 'Midnight Black',
    gradient: {
      type: 'linear',
      angle: 180,
      colors: [
        { color: '#000000', position: 0 },
        { color: '#1a1a1a', position: 0.5 },
        { color: '#2d2d2d', position: 1 },
      ],
    },
  },
  {
    keywords: ['vampire', 'blood', 'gothic', 'dramatic'],
    name: 'Gothic Blood',
    gradient: {
      type: 'linear',
      angle: 135,
      colors: [
        { color: '#0F0F0F', position: 0 },
        { color: '#8B0000', position: 0.5 },
        { color: '#FF0000', position: 1 },
      ],
    },
  },
  
  // Seasonal
  {
    keywords: ['spring', 'bloom', 'fresh', 'renewal'],
    name: 'Spring Bloom',
    gradient: {
      type: 'linear',
      angle: 135,
      colors: [
        { color: '#FFC3A0', position: 0 },
        { color: '#FFAFBD', position: 0.5 },
        { color: '#C9D6FF', position: 1 },
      ],
    },
  },
  {
    keywords: ['summer', 'sunshine', 'warm', 'bright'],
    name: 'Summer Sunshine',
    gradient: {
      type: 'linear',
      angle: 0,
      colors: [
        { color: '#FFA500', position: 0 },
        { color: '#FFFF00', position: 0.5 },
        { color: '#FF6347', position: 1 },
      ],
    },
  },
  {
    keywords: ['winter', 'ice', 'frost', 'frozen', 'cold'],
    name: 'Winter Frost',
    gradient: {
      type: 'linear',
      angle: 180,
      colors: [
        { color: '#E0FFFF', position: 0 },
        { color: '#B0E0E6', position: 0.5 },
        { color: '#4682B4', position: 1 },
      ],
    },
  },
  
  // Abstract & Artistic
  {
    keywords: ['rainbow', 'colorful', 'vibrant', 'spectrum', 'pride'],
    name: 'Rainbow Spectrum',
    gradient: {
      type: 'linear',
      angle: 90,
      colors: [
        { color: '#FF0000', position: 0 },
        { color: '#FF7F00', position: 0.16 },
        { color: '#FFFF00', position: 0.33 },
        { color: '#00FF00', position: 0.5 },
        { color: '#0000FF', position: 0.66 },
        { color: '#4B0082', position: 0.83 },
        { color: '#9400D3', position: 1 },
      ],
    },
  },
  {
    keywords: ['sunset', 'warm', 'orange', 'pink'],
    name: 'Warm Sunset',
    gradient: {
      type: 'linear',
      angle: 45,
      colors: [
        { color: '#FF512F', position: 0 },
        { color: '#F09819', position: 0.5 },
        { color: '#DD2476', position: 1 },
      ],
    },
  },
  {
    keywords: ['instagram', 'social', 'modern', 'trendy'],
    name: 'Instagram Vibes',
    gradient: {
      type: 'linear',
      angle: 135,
      colors: [
        { color: '#833AB4', position: 0 },
        { color: '#FD1D1D', position: 0.5 },
        { color: '#FCB045', position: 1 },
      ],
    },
  },
];

// Popular search suggestions
const POPULAR_SEARCHES = [
  'Ocean sunset',
  'Corporate blue',
  'Neon cyberpunk',
  'Pastel soft',
  'Luxury gold',
  'Galaxy space',
  'Forest nature',
  'Fire energy',
];

export function SemanticSearchPanel({ onGradientGenerated }: SemanticSearchPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<GradientPreset | null>(null);

  // Search and match gradients
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const query = searchQuery.toLowerCase().trim();
    const queryWords = query.split(/\s+/);

    // Score each preset based on keyword matches
    const scored = GRADIENT_PRESETS.map((preset) => {
      let score = 0;
      
      // Exact match bonus
      if (preset.keywords.some(kw => kw === query)) {
        score += 100;
      }
      
      // Partial match
      preset.keywords.forEach((keyword) => {
        if (keyword.includes(query) || query.includes(keyword)) {
          score += 50;
        }
        
        // Individual word matches
        queryWords.forEach((word) => {
          if (keyword.includes(word) || word.includes(keyword)) {
            score += 10;
          }
        });
      });

      return { preset, score };
    });

    // Filter and sort by score
    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((item) => item.preset);
  }, [searchQuery]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setSelectedPreset(null);
  };

  const handlePresetSelect = (preset: GradientPreset) => {
    setSelectedPreset(preset);
  };

  const handleApplyGradient = (preset: GradientPreset) => {
    onGradientGenerated(preset.gradient as GradientConfig);
    toast.success(`Applied "${preset.name}" gradient!`);
  };

  const renderGradientPreview = (preset: GradientPreset) => {
    const { type, angle = 90, colors } = preset.gradient;
    const colorStops = colors
      .map((c) => `${c.color} ${c.position * 100}%`)
      .join(', ');

    let backgroundImage = '';
    if (type === 'linear') {
      backgroundImage = `linear-gradient(${angle}deg, ${colorStops})`;
    } else if (type === 'radial') {
      backgroundImage = `radial-gradient(circle, ${colorStops})`;
    } else if (type === 'conic') {
      backgroundImage = `conic-gradient(from ${angle}deg, ${colorStops})`;
    }

    return backgroundImage;
  };

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search gradients... (e.g., ocean sunset)"
          className="w-full pl-10 pr-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-[#51A2FF] transition-colors"
        />
      </div>

      {/* Popular Searches */}
      {!searchQuery && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-zinc-400" />
            <h4 className="text-xs font-medium text-zinc-400">Popular Searches</h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {POPULAR_SEARCHES.map((search) => (
              <button
                key={search}
                onClick={() => handleSearch(search)}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-[#51A2FF] rounded-full text-xs text-zinc-300 transition-all"
              >
                {search}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search Results */}
      {searchQuery && searchResults.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-zinc-300">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
            </h4>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {searchResults.map((preset, index) => (
              <div
                key={index}
                className={`group relative rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                  selectedPreset === preset
                    ? 'border-[#51A2FF] shadow-lg shadow-[#51A2FF]/20'
                    : 'border-zinc-700 hover:border-zinc-500'
                }`}
                onClick={() => handlePresetSelect(preset)}
              >
                <div
                  className="h-24 w-full"
                  style={{ background: renderGradientPreview(preset) }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-2">
                  <p className="text-xs font-medium text-white truncate">
                    {preset.name}
                  </p>
                  <p className="text-[10px] text-zinc-300 opacity-80">
                    {preset.gradient.colors.length} colors
                  </p>
                </div>
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
              </div>
            ))}
          </div>

          {/* Apply Button */}
          {selectedPreset && (
            <button
              onClick={() => handleApplyGradient(selectedPreset)}
              className="w-full px-4 py-3 bg-[#51A2FF] hover:bg-[#4192EF] text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Apply "{selectedPreset.name}"
            </button>
          )}
        </div>
      )}

      {/* No Results */}
      {searchQuery && searchResults.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
          <Search className="w-8 h-8 text-zinc-600" />
          <p className="text-sm text-zinc-400">No gradients found</p>
          <p className="text-xs text-zinc-600">
            Try "ocean", "sunset", "neon", or "corporate"
          </p>
        </div>
      )}

      {/* Empty State */}
      {!searchQuery && (
        <div className="flex flex-col items-center justify-center py-6 text-center space-y-2">
          <Sparkles className="w-8 h-8 text-zinc-600" />
          <p className="text-sm text-zinc-400">Search with natural language</p>
          <p className="text-xs text-zinc-600">
            Describe colors, moods, or themes
          </p>
        </div>
      )}
    </div>
  );
}