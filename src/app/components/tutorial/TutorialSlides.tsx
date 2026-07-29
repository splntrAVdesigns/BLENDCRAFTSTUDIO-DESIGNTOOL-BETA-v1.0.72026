import { useState } from 'react';
import { Button } from '../ui/button';
import BlendcraftIcon from 'figma:asset/987cf5f33064a7023b59cef30c3e7f415b485d24.png';
import {
  Sparkles,
  Layers,
  Wand2,
  Film,
  Palette,
  Download,
  ChevronLeft,
  ChevronRight,
  X,
  Circle,
} from 'lucide-react';

interface TutorialSlidesProps {
  onComplete: () => void;
  onSkip: () => void;
}

interface Slide {
  title: string;
  description: string;
  icon: React.ReactNode;
  features: string[];
  tip?: string;
}

const slides: Slide[] = [
  {
    title: 'Welcome to Blendcraft Studio',
    description: 'A professional gradient and texture studio designed for creators who demand precision, beauty, and control.',
    icon: <Sparkles className="w-16 h-16 text-blue-400" />,
    features: [
      '14 gradient types with full customization',
      'Layer-based composition with masking',
      'Real-time animation and effects',
      'High-quality export in multiple formats',
      'WebGL-powered rendering for smooth performance',
    ],
    tip: 'Use keyboard shortcuts for faster workflow - press ? to see all shortcuts',
  },
  {
    title: 'Gradient Types & Customization',
    description: 'Choose from 14 professional gradient types and customize every aspect with precision controls.',
    icon: <Palette className="w-16 h-16 text-blue-400" />,
    features: [
      'Linear, Radial, Angular, and Diamond gradients',
      'Spiral, Square, and Star patterns',
      'Mesh gradients with 4-point and 9-point control',
      'Striped and Wave effects',
      'Unlimited color stops with precise positioning',
      'Interactive canvas for real-time adjustment',
    ],
    tip: 'Click the Interactive toggle to drag and adjust gradients directly on the canvas',
  },
  {
    title: 'Layers & Masking',
    description: 'Build complex compositions with multiple layers and use masking for precise control.',
    icon: <Layers className="w-16 h-16 text-blue-400" />,
    features: [
      'Unlimited layers with individual settings',
      'Blend modes: Normal, Multiply, Screen, Overlay',
      'Opacity control per layer',
      'Image masking with upload support',
      'Reorder layers with drag and drop',
      'Isolate layers for focused editing',
    ],
    tip: 'Use [ and ] shortcuts to toggle panels and maximize your workspace',
  },
  {
    title: 'Animation & Effects',
    description: 'Bring your gradients to life with smooth animations and professional effects.',
    icon: <Film className="w-16 h-16 text-blue-400" />,
    features: [
      'Position, rotation, and scale animation',
      'Color cycling with customizable speed',
      'Multiple easing curves for natural motion',
      'Real-time preview with play/pause controls',
      'Per-layer animation settings',
      'Video recording up to 60 FPS',
    ],
    tip: 'Press Space to quickly play/pause animations and R to start/stop recording',
  },
  {
    title: 'Textures & Post-Processing',
    description: 'Add depth and character with textures, noise, and advanced post-processing effects.',
    icon: <Wand2 className="w-16 h-16 text-blue-400" />,
    features: [
      'Grain, noise, and dithering textures',
      'Perlin and Simplex noise generation',
      'Blur, vignette, and chromatic aberration',
      'Color grading: temperature, tint, saturation',
      'Posterize with dithering options',
      'Halftone and creative shape overlays',
    ],
    tip: 'Combine multiple effects for unique artistic styles - experiment freely!',
  },
  {
    title: 'Export & Share',
    description: 'Export your creations in high quality for any use case, from web to print.',
    icon: <Download className="w-16 h-16 text-blue-400" />,
    features: [
      'Image formats: PNG, JPG, WebP',
      'Video formats: MP4, WebM, GIF',
      'Custom resolution up to 4K',
      'Quality control for file size optimization',
      'Frame rate options: 24, 30, 60 FPS',
      'One-click download with progress tracking',
    ],
    tip: 'Use CMD/CTRL+E to quickly export your current gradient as PNG',
  },
];

export function TutorialSlides({ onComplete, onSkip }: TutorialSlidesProps) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const handleNext = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    } else {
      onComplete();
    }
  };

  const handlePrev = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  };

  const slide = slides[currentSlide];
  const isLastSlide = currentSlide === slides.length - 1;
  const isFirstSlide = currentSlide === 0;

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/95 backdrop-blur-sm flex items-center justify-center p-8">
      {/* Close/Skip button */}
      <button
        onClick={onSkip}
        className="absolute top-8 right-8 text-zinc-400 hover:text-zinc-100 transition-colors"
        title="Skip tutorial"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Main content */}
      <div className="w-full max-w-4xl">
        {/* Slide content - First slide same size as others */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-12 shadow-2xl">
          {/* Icon - show for all slides */}
          <div className="flex justify-center mb-8">
            <div className="p-6 bg-zinc-800/50 rounded-2xl">
              {slide.icon}
            </div>
          </div>

          {/* Title */}
          <h2 className={`text-3xl font-semibold text-center mb-4 ${
            isFirstSlide 
              ? 'bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-500 bg-clip-text text-transparent' 
              : 'text-zinc-100'
          }`}>
            {slide.title}
          </h2>

          {/* Description */}
          <p className="text-lg text-zinc-300 text-center mb-10 max-w-2xl mx-auto">
            {slide.description}
          </p>

          {/* Features list */}
          <div className="mb-8 max-w-2xl mx-auto">
            <ul className="space-y-3">
              {slide.features.map((feature, index) => (
                <li key={index} className="flex items-start gap-3 text-zinc-200">
                  <Circle className="w-2 h-2 mt-2 flex-shrink-0 fill-blue-400 text-blue-400" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Tip box */}
          {slide.tip && (
            <div className="bg-blue-950/30 border border-blue-900/50 rounded-lg p-4 mb-8 max-w-2xl mx-auto">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-blue-300 mb-1">Pro Tip</div>
                  <div className="text-sm text-zinc-300">{slide.tip}</div>
                </div>
              </div>
            </div>
          )}

          {/* Progress indicators */}
          <div className="flex justify-center gap-2 mb-8">
            {slides.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentSlide(index)}
                className={`h-2 rounded-full transition-all ${
                  index === currentSlide
                    ? 'w-8 bg-blue-500'
                    : 'w-2 bg-zinc-700 hover:bg-zinc-600'
                }`}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between gap-4">
            <Button
              onClick={handlePrev}
              disabled={isFirstSlide}
              variant="ghost"
              size="lg"
              className="text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5 mr-2" />
              Previous
            </Button>

            <div className="text-sm text-zinc-500">
              {currentSlide + 1} / {slides.length}
            </div>

            <Button
              onClick={handleNext}
              size="lg"
              className="bg-blue-600 hover:bg-blue-500 text-white"
            >
              {isLastSlide ? (
                <>
                  Get Started
                  <Sparkles className="w-5 h-5 ml-2" />
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="w-5 h-5 ml-2" />
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Skip link */}
        <div className="text-center mt-6">
          <button
            onClick={onSkip}
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Skip tutorial
          </button>
        </div>
      </div>
    </div>
  );
}