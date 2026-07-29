import React, { useState } from 'react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../ui/accordion';
import { Lightbulb, Sparkles, Zap, Palette, Film, Download, Code, Star, TrendingUp } from 'lucide-react';
import type { GradientConfig, Layer } from '../../types/gradient';

interface ProTip {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  icon: React.ReactNode;
  applyExample?: () => GradientConfig;
  tags?: string[];
}

interface ContextualTip {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  priority: number; // Higher = more important to show
}

interface ProTipsPanelProps {
  onApplyExample?: (gradient: GradientConfig) => void;
  activeLayer?: Layer;
  layers?: Layer[];
  fps?: number;
}

export function ProTipsPanel({ onApplyExample, activeLayer, layers = [], fps }: ProTipsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [learnedTips, setLearnedTips] = useState<Set<string>>(new Set());
  const [favoriteTips, setFavoriteTips] = useState<Set<string>>(new Set());

  // ProTips Database - Phase 1 Initial Content
  const proTips: ProTip[] = [
    // Quick Start Category (7 tips: 5 beginner + 2 intermediate)
    {
      id: 'quick-start-1',
      title: 'Start Simple: 2-3 Colors',
      description: 'Begin with just 2-3 colors for clean, professional gradients. You can always add more complexity later.',
      category: 'Quick Start',
      difficulty: 'beginner',
      icon: <Palette className="w-4 h-4" />,
      tags: ['beginner', 'colors', 'basics'],
      applyExample: () => ({
        type: 'linear',
        colors: [
          { color: '#667eea', position: 0 },
          { color: '#764ba2', position: 1 },
        ],
        angle: 135,
      }),
    },
    {
      id: 'quick-start-2',
      title: 'Browse the Gradient Library',
      description: 'Search by mood or style — try "sunset", "ocean", or "forest" in the Library tab to instantly find beautiful gradient presets.',
      category: 'Quick Start',
      difficulty: 'beginner',
      icon: <Sparkles className="w-4 h-4" />,
      tags: ['search', 'presets', 'beginner'],
    },
    {
      id: 'quick-start-3',
      title: 'Color Stop Selection',
      description: 'Click any color stop in the "Color Stop Selection" panel to edit it individually with the Picker or Harmony tools.',
      category: 'Quick Start',
      difficulty: 'beginner',
      icon: <Palette className="w-4 h-4" />,
      tags: ['colors', 'editing', 'beginner'],
    },
    {
      id: 'quick-start-4',
      title: 'Randomize for Inspiration',
      description: 'Hit the Randomize button to generate unique gradient combinations. Lock colors you like and randomize the rest!',
      category: 'Quick Start',
      difficulty: 'beginner',
      icon: <Zap className="w-4 h-4" />,
      tags: ['randomize', 'inspiration', 'beginner'],
    },
    {
      id: 'quick-start-5',
      title: 'Save to Favorites',
      description: 'Found a gradient you love? Save it to Favorites so you can quickly access and reuse it in future projects.',
      category: 'Quick Start',
      difficulty: 'beginner',
      icon: <Star className="w-4 h-4" />,
      tags: ['favorites', 'workflow', 'beginner'],
    },
    {
      id: 'quick-start-6',
      title: 'Layer Multiple Gradients',
      description: 'Combine 2-3 gradient layers with different blend modes for rich, complex effects. Try "overlay" or "multiply" for depth.',
      category: 'Quick Start',
      difficulty: 'intermediate',
      icon: <Zap className="w-4 h-4" />,
      tags: ['layers', 'blending', 'intermediate'],
    },
    {
      id: 'quick-start-7',
      title: 'Adjust Color Stop Positions',
      description: 'Fine-tune where colors transition by dragging color stops. Spacing them unevenly creates more dynamic, interesting gradients.',
      category: 'Quick Start',
      difficulty: 'intermediate',
      icon: <Palette className="w-4 h-4" />,
      tags: ['color stops', 'positioning', 'intermediate'],
      applyExample: () => ({
        type: 'linear',
        colors: [
          { color: '#FF6B6B', position: 0 },
          { color: '#FFE66D', position: 0.3 },
          { color: '#4ECDC4', position: 1 },
        ],
        angle: 90,
      }),
    },

    // Gradient Types Category (8 tips: 2 beginner + 4 intermediate + 2 advanced)
    {
      id: 'gradient-1',
      title: 'Radial for Spotlight Effects',
      description: 'Radial gradients are perfect for creating spotlight effects, glowing orbs, and vignettes. Place the center strategically for dramatic results.',
      category: 'Gradient Types',
      difficulty: 'intermediate',
      icon: <Sparkles className="w-4 h-4" />,
      tags: ['radial', 'effects', 'intermediate'],
      applyExample: () => ({
        type: 'radial',
        colors: [
          { color: '#ffffff', position: 0 },
          { color: '#ffd700', position: 0.3 },
          { color: '#1a1a1a', position: 1 },
        ],
        centerX: 0.5,
        centerY: 0.5,
      }),
    },
    {
      id: 'gradient-2',
      title: 'Conic for Color Wheels',
      description: 'Conic gradients rotate colors around a center point - ideal for color wheels, loading spinners, and psychedelic effects.',
      category: 'Gradient Types',
      difficulty: 'intermediate',
      icon: <Code className="w-4 h-4" />,
      tags: ['conic', 'rotation', 'intermediate'],
      applyExample: () => ({
        type: 'conic',
        colors: [
          { color: '#ff0000', position: 0 },
          { color: '#ffff00', position: 0.17 },
          { color: '#00ff00', position: 0.33 },
          { color: '#00ffff', position: 0.5 },
          { color: '#0000ff', position: 0.67 },
          { color: '#ff00ff', position: 0.83 },
          { color: '#ff0000', position: 1 },
        ],
        centerX: 0.5,
        centerY: 0.5,
      }),
    },
    {
      id: 'gradient-3',
      title: 'Linear Angles Matter',
      description: 'For linear gradients, try 45° angles for dynamic diagonal flows, or 90°/270° for classic vertical transitions.',
      category: 'Gradient Types',
      difficulty: 'beginner',
      icon: <Zap className="w-4 h-4" />,
      tags: ['linear', 'angles', 'beginner'],
      applyExample: () => ({
        type: 'linear',
        colors: [
          { color: '#fa709a', position: 0 },
          { color: '#fee140', position: 1 },
        ],
        angle: 45,
      }),
    },
    {
      id: 'gradient-4',
      title: 'Topography for Organic Motion',
      description: 'Enable Topography texture with Drift or Flow animation for mesmerizing, lava-lamp-like organic effects.',
      category: 'Gradient Types',
      difficulty: 'advanced',
      icon: <Film className="w-4 h-4" />,
      tags: ['topography', 'animation', 'advanced'],
    },
    {
      id: 'gradient-5',
      title: 'Diamond Gradients for Focus',
      description: 'Diamond gradients draw the eye to the center - perfect for hero sections, call-to-action backgrounds, and focal points.',
      category: 'Gradient Types',
      difficulty: 'beginner',
      icon: <Sparkles className="w-4 h-4" />,
      tags: ['diamond', 'focus', 'beginner'],
    },
    {
      id: 'gradient-6',
      title: 'Spiral for Hypnotic Effects',
      description: 'Spiral gradients create mesmerizing, vortex-like patterns. Combine with slow rotation animation for truly hypnotic visuals.',
      category: 'Gradient Types',
      difficulty: 'intermediate',
      icon: <Film className="w-4 h-4" />,
      tags: ['spiral', 'vortex', 'intermediate'],
      applyExample: () => ({
        type: 'spiral',
        colors: [
          { color: '#8A2BE2', position: 0 },
          { color: '#FF1493', position: 0.5 },
          { color: '#00CED1', position: 1 },
        ],
        centerX: 0.5,
        centerY: 0.5,
        twist: 5,
      }),
    },
    {
      id: 'gradient-7',
      title: 'Square Gradients for Borders',
      description: 'Square gradients are excellent for creating frame effects, borders, and geometric compositions. Adjust corner positions for unique shapes.',
      category: 'Gradient Types',
      difficulty: 'intermediate',
      icon: <Code className="w-4 h-4" />,
      tags: ['square', 'borders', 'intermediate'],
    },
    {
      id: 'gradient-8',
      title: 'Mix Gradient Types in Layers',
      description: 'Stack a linear gradient base with a radial gradient overlay for complex, multi-dimensional effects. Experiment with blend modes.',
      category: 'Gradient Types',
      difficulty: 'advanced',
      icon: <Zap className="w-4 h-4" />,
      tags: ['layers', 'mixing', 'advanced'],
    },

    // Color Theory Category (6 tips: 1 beginner + 3 intermediate + 2 advanced)
    {
      id: 'color-1',
      title: 'Use Complementary Colors',
      description: 'Select a base color and use the Harmony tab\'s "Complementary" scheme for bold, high-contrast gradients that pop.',
      category: 'Color Theory',
      difficulty: 'intermediate',
      icon: <Palette className="w-4 h-4" />,
      tags: ['harmony', 'color theory', 'intermediate'],
    },
    {
      id: 'color-2',
      title: 'Analogous for Smoothness',
      description: 'Analogous color schemes (neighboring colors on the wheel) create smooth, harmonious gradients perfect for backgrounds.',
      category: 'Color Theory',
      difficulty: 'intermediate',
      icon: <Palette className="w-4 h-4" />,
      tags: ['harmony', 'smooth', 'intermediate'],
    },
    {
      id: 'color-3',
      title: 'Extract from Images',
      description: 'Upload a photo in the Extract tab to pull its color palette - perfect for matching brand colors or capturing real-world hues.',
      category: 'Color Theory',
      difficulty: 'beginner',
      icon: <Sparkles className="w-4 h-4" />,
      tags: ['extractor', 'photos', 'beginner'],
    },
    {
      id: 'color-4',
      title: 'Triadic for Vibrant Energy',
      description: 'Triadic color schemes use three evenly-spaced colors on the wheel for vibrant, energetic gradients with balanced contrast.',
      category: 'Color Theory',
      difficulty: 'intermediate',
      icon: <Palette className="w-4 h-4" />,
      tags: ['harmony', 'triadic', 'intermediate'],
    },
    {
      id: 'color-5',
      title: 'Adjust Color Temperature',
      description: 'Warm colors (reds, oranges) advance toward the viewer while cool colors (blues, greens) recede. Use this for depth.',
      category: 'Color Theory',
      difficulty: 'advanced',
      icon: <Zap className="w-4 h-4" />,
      tags: ['temperature', 'depth', 'advanced'],
    },
    {
      id: 'color-6',
      title: 'Master Opacity Transitions',
      description: 'Fade colors to transparent for glass-morphism effects. Place transparent stops strategically for sophisticated layering.',
      category: 'Color Theory',
      difficulty: 'advanced',
      icon: <Sparkles className="w-4 h-4" />,
      tags: ['opacity', 'transparency', 'advanced'],
    },

    // Effects & Textures Category (6 tips: 1 beginner + 3 intermediate + 2 advanced)
    {
      id: 'texture-1',
      title: 'Subtle Noise for Realism',
      description: 'Add 10-20% noise intensity to eliminate color banding and give gradients a natural, printed texture quality.',
      category: 'Effects & Textures',
      difficulty: 'beginner',
      icon: <Sparkles className="w-4 h-4" />,
      tags: ['noise', 'texture', 'beginner'],
    },
    {
      id: 'texture-2',
      title: 'Grain for Vintage Vibes',
      description: 'Increase grain intensity (30-50%) for retro, film-like aesthetics. Combine with warm color palettes for nostalgic effects.',
      category: 'Effects & Textures',
      difficulty: 'intermediate',
      icon: <Film className="w-4 h-4" />,
      tags: ['grain', 'vintage', 'intermediate'],
    },
    {
      id: 'texture-3',
      title: 'Topography Scale Control',
      description: 'Adjust topography scale (1-5) for different organic patterns. Lower values create fine, detailed textures; higher values make bold shapes.',
      category: 'Effects & Textures',
      difficulty: 'intermediate',
      icon: <Code className="w-4 h-4" />,
      tags: ['topography', 'scale', 'intermediate'],
    },
    {
      id: 'texture-4',
      title: 'Layer Textures for Complexity',
      description: 'Stack multiple texture layers with different settings - try grain on the base layer and topography on top for rich depth.',
      category: 'Effects & Textures',
      difficulty: 'advanced',
      icon: <Zap className="w-4 h-4" />,
      tags: ['layering', 'textures', 'advanced'],
    },
    {
      id: 'texture-5',
      title: 'Animate Texture Intensity',
      description: 'Enable animation on textured layers and adjust intensity over time for pulsing, breathing effects.',
      category: 'Effects & Textures',
      difficulty: 'advanced',
      icon: <Film className="w-4 h-4" />,
      tags: ['animation', 'texture', 'advanced'],
    },
    {
      id: 'texture-6',
      title: 'Blend Modes with Textures',
      description: 'Try "screen" blend mode on texture layers for glowing effects, or "multiply" for shadow-like depth.',
      category: 'Effects & Textures',
      difficulty: 'intermediate',
      icon: <Sparkles className="w-4 h-4" />,
      tags: ['blend modes', 'textures', 'intermediate'],
    },

    // Animation Category (5 tips: 1 beginner + 2 intermediate + 2 advanced)
    {
      id: 'animation-1',
      title: 'Slow & Subtle Animation',
      description: 'For professional results, keep animation speed between 0.3-0.7. Slower movements feel more elegant and less distracting.',
      category: 'Animation',
      difficulty: 'intermediate',
      icon: <Film className="w-4 h-4" />,
      tags: ['animation', 'speed', 'intermediate'],
    },
    {
      id: 'animation-2',
      title: 'Topography Drift Mode',
      description: 'Drift mode creates gentle, wandering motion - perfect for ambient backgrounds. Flow mode is faster and more dynamic.',
      category: 'Animation',
      difficulty: 'intermediate',
      icon: <Film className="w-4 h-4" />,
      tags: ['topography', 'drift', 'intermediate'],
    },
    {
      id: 'animation-3',
      title: 'Combine Rotation + Texture',
      description: 'Enable both rotation animation and topography texture for hypnotic, kaleidoscope-like effects.',
      category: 'Animation',
      difficulty: 'advanced',
      icon: <Film className="w-4 h-4" />,
      tags: ['rotation', 'texture', 'advanced'],
    },
    {
      id: 'animation-4',
      title: 'Loop Seamlessly',
      description: 'Enable "Loop" in animation settings for endless, smooth cycles. Essential for video backgrounds and installations.',
      category: 'Animation',
      difficulty: 'beginner',
      icon: <Film className="w-4 h-4" />,
      tags: ['loop', 'seamless', 'beginner'],
    },
    {
      id: 'animation-5',
      title: 'Offset Layer Animations',
      description: 'Animate multiple layers at different speeds and directions for complex, layered motion graphics.',
      category: 'Animation',
      difficulty: 'advanced',
      icon: <Zap className="w-4 h-4" />,
      tags: ['layers', 'timing', 'advanced'],
    },

    // Export Guide Category (5 tips: 2 beginner + 2 intermediate + 1 advanced)
    {
      id: 'export-1',
      title: 'PNG for Static Images',
      description: 'Use PNG export for high-quality static images. Perfect for wallpapers, social media graphics, and print materials.',
      category: 'Export Guide',
      difficulty: 'beginner',
      icon: <Download className="w-4 h-4" />,
      tags: ['export', 'png', 'beginner'],
    },
    {
      id: 'export-2',
      title: 'SVG for Scalability',
      description: 'Export to SVG for infinitely scalable graphics. Ideal for logos, icons, and web graphics that need to resize perfectly.',
      category: 'Export Guide',
      difficulty: 'beginner',
      icon: <Download className="w-4 h-4" />,
      tags: ['export', 'svg', 'beginner'],
    },
    {
      id: 'export-3',
      title: 'MP4/WebM for Animation',
      description: 'Recording animated gradients? Use MP4 for compatibility or WebM for smaller file sizes. Enable looping for seamless playback.',
      category: 'Export Guide',
      difficulty: 'intermediate',
      icon: <Film className="w-4 h-4" />,
      tags: ['export', 'video', 'animation'],
    },
    {
      id: 'export-4',
      title: 'CSS for Web Development',
      description: 'Export CSS code to use your gradient directly in web projects. Copy the code and paste it into your stylesheets.',
      category: 'Export Guide',
      difficulty: 'intermediate',
      icon: <Code className="w-4 h-4" />,
      tags: ['export', 'css', 'web'],
    },
    {
      id: 'export-5',
      title: 'GIF for Universal Compatibility',
      description: 'Export animated gradients as GIF for maximum compatibility across platforms. Adjust quality settings for file size optimization.',
      category: 'Export Guide',
      difficulty: 'advanced',
      icon: <Download className="w-4 h-4" />,
      tags: ['export', 'gif', 'compatibility'],
    },

    // Performance Category (5 tips: 1 beginner + 3 intermediate + 1 advanced)
    {
      id: 'performance-1',
      title: 'Disable Unused Layers',
      description: 'Turn off visibility for layers you\'re not using to boost performance. Each active layer requires GPU processing.',
      category: 'Performance',
      difficulty: 'intermediate',
      icon: <Zap className="w-4 h-4" />,
      tags: ['performance', 'layers', 'intermediate'],
    },
    {
      id: 'performance-2',
      title: 'Lower Noise Intensity First',
      description: 'If you experience lag, reduce noise/grain intensity before disabling effects entirely. Lower values still look great!',
      category: 'Performance',
      difficulty: 'intermediate',
      icon: <Zap className="w-4 h-4" />,
      tags: ['performance', 'noise', 'intermediate'],
    },
    {
      id: 'performance-3',
      title: 'Monitor FPS Display',
      description: 'Watch the FPS counter to ensure smooth performance. Aim for 60 FPS for best results. Drop below 30? Time to optimize.',
      category: 'Performance',
      difficulty: 'beginner',
      icon: <Zap className="w-4 h-4" />,
      tags: ['fps', 'monitoring', 'beginner'],
    },
    {
      id: 'performance-4',
      title: 'Optimize Animation Settings',
      description: 'Reduce animation speed and intensity if performance suffers. Simple animations render much faster than complex ones.',
      category: 'Performance',
      difficulty: 'intermediate',
      icon: <Film className="w-4 h-4" />,
      tags: ['animation', 'optimization', 'intermediate'],
    },
    {
      id: 'performance-5',
      title: 'WebGL Shader Efficiency',
      description: 'Each shader effect compounds GPU load. Use 2-3 effects maximum per layer for optimal 60+ FPS performance.',
      category: 'Performance',
      difficulty: 'advanced',
      icon: <Code className="w-4 h-4" />,
      tags: ['webgl', 'shaders', 'advanced'],
    },
  ];

  // Contextual Tips based on activeLayer and layers
  const getContextualTips = (): ContextualTip[] => {
    const tips: ContextualTip[] = [];

    // No active layer - suggest starting
    if (!activeLayer) {
      tips.push({
        id: 'ctx-no-layer',
        title: 'Get Started',
        description: 'Select a layer from the left panel or create a new one to begin crafting your gradient masterpiece.',
        icon: <Sparkles className="w-4 h-4" />,
        priority: 10,
      });
      return tips;
    }

    const gradient = activeLayer.gradient;
    const texture = activeLayer.texture;
    const animation = activeLayer.animation;

    // Gradient-specific tips
    if (gradient) {
      // Linear gradient - angle tip
      if (gradient.type === 'linear' && gradient.angle !== undefined) {
        if (gradient.angle % 90 === 0) {
          tips.push({
            id: 'ctx-linear-angle',
            title: 'Try Diagonal Angles',
            description: 'Your linear gradient uses a straight angle. Try 45° or 135° for dynamic diagonal flows.',
            icon: <Zap className="w-4 h-4" />,
            priority: 7,
          });
        }
      }

      // Radial/Conic - center position
      if ((gradient.type === 'radial' || gradient.type === 'conic') && gradient.centerX === 0.5 && gradient.centerY === 0.5) {
        tips.push({
          id: 'ctx-center-position',
          title: 'Adjust Center Position',
          description: 'Your gradient is centered. Try moving it off-center for more dramatic, asymmetric effects.',
          icon: <Sparkles className="w-4 h-4" />,
          priority: 6,
        });
      }

      // Too many color stops
      if (gradient.colors && gradient.colors.length > 5) {
        tips.push({
          id: 'ctx-many-colors',
          title: 'Simplify Colors',
          description: `You have ${gradient.colors.length} color stops. Consider simplifying to 2-4 colors for a cleaner, more professional look.`,
          icon: <Palette className="w-4 h-4" />,
          priority: 8,
        });
      }

      // Too few color stops
      if (gradient.colors && gradient.colors.length === 2) {
        tips.push({
          id: 'ctx-add-color',
          title: 'Add More Colors',
          description: 'Try adding a third color stop for more depth and interest. Click between existing stops to add new colors.',
          icon: <Palette className="w-4 h-4" />,
          priority: 5,
        });
      }

      // Spiral/noise-spiral specific
      if (gradient.type === 'spiral' || gradient.type === 'noise-spiral') {
        tips.push({
          id: 'ctx-spiral',
          title: 'Animate Your Spiral',
          description: 'Spiral gradients look amazing with rotation animation. Enable it in the Animation panel for hypnotic effects.',
          icon: <Film className="w-4 h-4" />,
          priority: 7,
        });
      }
    }

    // No texture - suggest adding
    if (!texture) {
      tips.push({
        id: 'ctx-no-texture',
        title: 'Add Texture',
        description: 'Try adding noise or topography texture for more depth and eliminating color banding. Start with 10-20% intensity.',
        icon: <Sparkles className="w-4 h-4" />,
        priority: 6,
      });
    }

    // Texture tips
    if (texture) {
      // Topography with no animation
      if (texture.type === 'topography' && (!texture.animateTexture || !animation?.enabled)) {
        tips.push({
          id: 'ctx-animate-topo',
          title: 'Animate Topography',
          description: 'Your topography texture is static. Enable texture animation for mesmerizing, lava-lamp-like organic motion.',
          icon: <Film className="w-4 h-4" />,
          priority: 9,
        });
      }

      // High intensity texture
      if (texture.intensity > 0.7) {
        tips.push({
          id: 'ctx-texture-intensity',
          title: 'Lower Texture Intensity',
          description: 'High texture intensity can be overwhelming. Try 30-50% for subtle realism or 10-20% for professional results.',
          icon: <Sparkles className="w-4 h-4" />,
          priority: 7,
        });
      }
    }

    // Animation tips
    if (animation?.enabled) {
      // Fast animation
      if (animation.speed > 2) {
        tips.push({
          id: 'ctx-slow-animation',
          title: 'Slow Down Animation',
          description: 'Fast animations can be distracting. Try speeds between 0.3-0.7 for elegant, professional movement.',
          icon: <Film className="w-4 h-4" />,
          priority: 8,
        });
      }
    } else {
      // No animation - suggest it
      tips.push({
        id: 'ctx-no-animation',
        title: 'Add Animation',
        description: 'Bring your gradient to life! Try rotation, drift, or pulse animation for dynamic, eye-catching effects.',
        icon: <Film className="w-4 h-4" />,
        priority: 5,
      });
    }

    // Layer-specific tips
    if (layers.length === 1) {
      tips.push({
        id: 'ctx-single-layer',
        title: 'Add Another Layer',
        description: 'Stack multiple gradient layers with different blend modes for rich, complex effects. Try "overlay" or "multiply".',
        icon: <Zap className="w-4 h-4" />,
        priority: 6,
      });
    }

    // Multiple layers with same blend mode
    if (layers.length > 1) {
      const allNormalBlend = layers.every(l => l.blendMode === 'normal');
      if (allNormalBlend) {
        tips.push({
          id: 'ctx-blend-modes',
          title: 'Experiment with Blend Modes',
          description: 'All layers use "normal" blend mode. Try "overlay", "multiply", or "screen" for interesting layer interactions.',
          icon: <Sparkles className="w-4 h-4" />,
          priority: 7,
        });
      }
    }

    // Opacity tip
    if (activeLayer.opacity === 1) {
      tips.push({
        id: 'ctx-opacity',
        title: 'Adjust Layer Opacity',
        description: 'Try lowering the layer opacity to 70-90% for subtle blending with other layers.',
        icon: <Zap className="w-4 h-4" />,
        priority: 4,
      });
    }

    // Performance tip based on FPS
    if (fps !== undefined && fps < 30) {
      tips.push({
        id: 'ctx-low-fps',
        title: 'Performance Warning',
        description: `Current FPS: ${Math.round(fps)}. Reduce texture intensity, disable unused layers, or simplify animations to improve performance.`,
        icon: <Zap className="w-4 h-4" />,
        priority: 10,
      });
    }

    // Sort by priority (higher first) and return top 5
    return tips.sort((a, b) => b.priority - a.priority).slice(0, 5);
  };

  const contextualTips = getContextualTips();

  // Group tips by category
  const categories = Array.from(new Set(proTips.map(tip => tip.category)));
  const groupedTips = categories.reduce((acc, category) => {
    acc[category] = proTips.filter(tip => tip.category === category);
    return acc;
  }, {} as Record<string, ProTip[]>);

  // Filter tips based on search and favorites
  const filteredTips = proTips.filter(tip => {
    const matchesSearch = searchQuery === '' || 
      tip.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tip.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tip.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesFavorites = !showFavoritesOnly || favoriteTips.has(tip.id);
    
    return matchesSearch && matchesFavorites;
  });

  const toggleLearned = (tipId: string) => {
    setLearnedTips(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tipId)) {
        newSet.delete(tipId);
      } else {
        newSet.add(tipId);
      }
      return newSet;
    });
  };

  const toggleFavorite = (tipId: string) => {
    setFavoriteTips(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tipId)) {
        newSet.delete(tipId);
      } else {
        newSet.add(tipId);
      }
      return newSet;
    });
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'beginner': return 'bg-green-500';
      case 'intermediate': return 'bg-yellow-500';
      case 'advanced': return 'bg-red-500';
      default: return 'bg-zinc-500';
    }
  };

  const getDifficultyIcon = (difficulty: string) => {
    switch (difficulty) {
      case 'beginner': return '🟢';
      case 'intermediate': return '🟡';
      case 'advanced': return '🔴';
      default: return '⚪';
    }
  };

  const learnedCount = learnedTips.size;
  const totalCount = proTips.length;
  const progressPercentage = (learnedCount / totalCount) * 100;

  return (
    <div className="space-y-4">
      {/* Header with Search and Stats */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-[#51A2FF]" />
            <h3 className="text-sm font-medium text-zinc-100">ProTips</h3>
          </div>
          <div className="text-xs text-zinc-400">
            {learnedCount}/{totalCount} explored
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-[#5200FF] to-[#51A2FF] transition-all duration-300"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>

        {/* Search Bar */}
        <input
          type="text"
          placeholder="Search tips..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-[#51A2FF]"
        />

        {/* Filter Toggle */}
        <button
          onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
          className={`w-full px-3 py-2 rounded text-xs font-medium transition-colors ${
            showFavoritesOnly 
              ? 'bg-[#51A2FF]/20 text-[#51A2FF] border border-[#51A2FF]/30' 
              : 'bg-zinc-900 text-zinc-400 border border-zinc-700 hover:border-zinc-600'
          }`}
        >
          {showFavoritesOnly ? '⭐ Showing Favorites Only' : '⭐ Show Favorites Only'}
        </button>

        {/* Difficulty Color Key */}
        <div className="flex items-center justify-center gap-4 px-3 py-2 bg-zinc-900/50 rounded border border-zinc-800">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            <span className="text-[10px] text-zinc-400">Beginner</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
            <span className="text-[10px] text-zinc-400">Intermediate</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-red-500"></div>
            <span className="text-[10px] text-zinc-400">Advanced</span>
          </div>
        </div>
      </div>

      {/* Contextual Tips Section - Always visible at top */}
      {contextualTips.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-[#5200FF]/20 to-[#51A2FF]/20 rounded border border-[#5200FF]/30">
            <TrendingUp className="w-4 h-4 text-[#51A2FF]" />
            <h4 className="text-sm font-medium text-zinc-100">Smart Tips For You</h4>
          </div>
          {contextualTips.map(tip => (
            <div
              key={tip.id}
              className="p-3 rounded-lg bg-gradient-to-br from-[#5200FF]/10 to-[#51A2FF]/10 border border-[#5200FF]/20"
            >
              <div className="flex items-start gap-2">
                <div className="text-[#51A2FF] mt-0.5 flex-shrink-0">{tip.icon}</div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-zinc-100 mb-1">{tip.title}</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">{tip.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tips by Category */}
      <Accordion type="multiple" defaultValue={[]} className="space-y-2">
        {categories.map(category => {
          const categoryTips = groupedTips[category].filter(tip => filteredTips.includes(tip));
          
          if (categoryTips.length === 0) return null;

          return (
            <AccordionItem key={category} value={category} className="border-none">
              <AccordionTrigger className="py-3 px-4 hover:no-underline bg-zinc-900/50 rounded">
                <div className="flex items-center justify-between w-full pr-2">
                  <span className="text-sm font-medium text-zinc-100">{category}</span>
                  <span className="text-xs text-zinc-500">{categoryTips.length} tips</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-2 pt-2 space-y-2">
                {categoryTips.map(tip => (
                  <div
                    key={tip.id}
                    className={`p-3 rounded-lg border transition-colors ${
                      learnedTips.has(tip.id)
                        ? 'bg-zinc-900/30 border-zinc-800/50'
                        : 'bg-zinc-900 border-zinc-800'
                    }`}
                  >
                    {/* Tip Header - Single Row */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="text-[#51A2FF] flex-shrink-0">{tip.icon}</div>
                        <h4 className="text-sm font-medium text-zinc-100 truncate">{tip.title}</h4>
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getDifficultyColor(tip.difficulty)}`}></div>
                      </div>
                      
                      {/* Action Buttons - Same Row */}
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          onClick={() => toggleFavorite(tip.id)}
                          className={`p-1 rounded transition-colors ${
                            favoriteTips.has(tip.id)
                              ? 'text-yellow-400 hover:text-yellow-300'
                              : 'text-zinc-600 hover:text-zinc-400'
                          }`}
                          title={favoriteTips.has(tip.id) ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          <Star className="w-3 h-3" fill={favoriteTips.has(tip.id) ? 'currentColor' : 'none'} />
                        </button>
                        <button
                          onClick={() => toggleLearned(tip.id)}
                          className={`p-1 rounded transition-colors ${
                            learnedTips.has(tip.id)
                              ? 'text-green-400 hover:text-green-300'
                              : 'text-zinc-600 hover:text-zinc-400'
                          }`}
                          title={learnedTips.has(tip.id) ? 'Mark as unread' : 'Mark as learned'}
                        >
                          <span className="text-xs">{learnedTips.has(tip.id) ? '✓' : '○'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Tip Description */}
                    <p className="text-xs text-zinc-400 leading-relaxed pl-6">{tip.description}</p>

                    {/* Apply Example Button */}
                    {tip.applyExample && onApplyExample && (
                      <button
                        onClick={() => {
                          const exampleGradient = tip.applyExample!();
                          onApplyExample(exampleGradient);
                          // Auto-mark as learned when applied
                          if (!learnedTips.has(tip.id)) {
                            toggleLearned(tip.id);
                          }
                        }}
                        className="mt-2 w-full px-3 py-1 bg-[#5200FF]/20 hover:bg-[#5200FF]/30 text-[#51A2FF] rounded text-xs font-medium transition-colors border border-[#5200FF]/30"
                      >
                        ✨ Apply Example
                      </button>
                    )}
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {/* No Results Message */}
      {filteredTips.length === 0 && (
        <div className="text-center py-8 text-zinc-500 text-sm">
          {showFavoritesOnly ? 'No favorite tips yet. Star tips to save them!' : 'No tips found. Try a different search.'}
        </div>
      )}
    </div>
  );
}