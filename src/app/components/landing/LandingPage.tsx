import { useEffect, useRef, useState } from 'react';
import * as THREE from '../../lib/three';
import { BlendcraftLogoSVG } from '../ui/BlendcraftLogoSVG';
import BlendcraftIcon from 'figma:asset/987cf5f33064a7023b59cef30c3e7f415b485d24.png';

interface LandingPageProps {
  onEnter: () => void;
}

export function LandingPage({ onEnter }: LandingPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const launchProgressRafRef = useRef<number | null>(null);
  const launchCompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Exposed so handleLaunchClick can dispose the renderer before main app WebGL init
  const landingRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Setup Three.js scene for animated gradient background
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    
    const renderer = new THREE.WebGLRenderer({ 
      canvas: canvasRef.current,
      antialias: false,
      alpha: false,
      powerPreference: 'default',
    });
    landingRendererRef.current = renderer;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1)); // PERFORMANCE: Cap at 1x for landing page

    // Create animated gradient shader material
    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;\n        uniform vec2 resolution;
        varying vec2 vUv;

        // Smooth noise function for organic movement
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

        float snoise(vec2 v) {
          const vec4 C = vec4(0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                              0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                             -0.577350269189626,  // -1.0 + 2.0 * C.x
                              0.024390243902439); // 1.0 / 41.0
          vec2 i  = floor(v + dot(v, C.yy) );
          vec2 x0 = v -   i + dot(i, C.xx);
          vec2 i1;
          i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
          vec4 x12 = x0.xyxy + C.xxzz;
          x12.xy -= i1;
          i = mod289(i);
          vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
            + i.x + vec3(0.0, i1.x, 1.0 ));
          vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
          m = m*m ;
          m = m*m ;
          vec3 x = 2.0 * fract(p * C.www) - 1.0;
          vec3 h = abs(x) - 0.5;
          vec3 ox = floor(x + 0.5);
          vec3 a0 = x - ox;
          m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
          vec3 g;
          g.x  = a0.x  * x0.x  + h.x  * x0.y;
          g.yz = a0.yz * x12.xz + h.yz * x12.yw;
          return 130.0 * dot(m, g);
        }

        void main() {
          vec2 uv = vUv;
          
          // UPDATED: Create flowing gradient with CYCLIC movement to prevent color convergence
          float t = time * 0.08; // Slower base speed
          
          // Create multiple oscillating noise layers with different frequencies
          // Use sin/cos for CYCLIC motion instead of linear drift
          vec2 flow1 = vec2(sin(t * 0.5), cos(t * 0.3)) * 0.5;
          vec2 flow2 = vec2(cos(t * 0.7), sin(t * 0.4)) * 0.3;
          vec2 flow3 = vec2(sin(t * 0.9), cos(t * 0.6)) * 0.2;
          
          // Multiple noise layers with cyclic offsets for continuous variety
          float noise1 = snoise(uv * 2.0 + flow1) * 0.5;
          float noise2 = snoise(uv * 3.0 + flow2) * 0.4;
          float noise3 = snoise(uv * 4.0 + flow3) * 0.3;
          float noise4 = snoise(uv * 1.5 + vec2(sin(t * 0.2), cos(t * 0.25))) * 0.6;
          
          float combinedNoise = noise1 + noise2 + noise3 + noise4;
          
          // UPDATED: Create base gradient that oscillates instead of drifting linearly
          float gradient = uv.x * 0.5 + uv.y * 0.5 + sin(t * 0.3) * 0.3;
          
          // Combine gradient with noise
          float value = gradient + combinedNoise;
          
          // UPDATED: Richer color palette with more variety (blues, purples, teals, magentas)
          vec3 color1 = vec3(0.05, 0.15, 0.35);  // Deep navy blue
          vec3 color2 = vec3(0.15, 0.35, 0.75);  // Bright blue
          vec3 color3 = vec3(0.45, 0.15, 0.65);  // Vibrant purple
          vec3 color4 = vec3(0.08, 0.45, 0.55);  // Teal/cyan
          vec3 color5 = vec3(0.55, 0.15, 0.45);  // Magenta
          vec3 color6 = vec3(0.12, 0.22, 0.42);  // Medium blue
          
          // UPDATED: Multi-stop gradient with oscillating interpolation
          // Use sin waves to cycle through colors instead of linear progression
          float colorCycle = sin(t * 0.15) * 0.5 + 0.5; // 0-1 oscillation
          float t1 = smoothstep(-1.0 + colorCycle * 0.3, 0.2, value);
          float t2 = smoothstep(-0.3, 0.7, value);
          float t3 = smoothstep(0.2, 1.2, value);
          float t4 = smoothstep(0.6, 1.6 + colorCycle * 0.3, value);
          float t5 = smoothstep(1.0, 2.0, value + sin(t * 0.2) * 0.4);
          
          // Blend colors with varying transitions
          vec3 finalColor = mix(color1, color2, t1);
          finalColor = mix(finalColor, color3, t2);
          finalColor = mix(finalColor, color4, t3);
          finalColor = mix(finalColor, color5, t4);
          finalColor = mix(finalColor, color6, t5);
          
          // UPDATED: Add pulsing brightness variation for liveliness
          float brightness = 1.0 + sin(t * 0.4) * 0.15 + snoise(uv * 2.0 + vec2(t * 0.1, 0.0)) * 0.2;
          finalColor *= brightness;
          
          // Add subtle color shifting over time to prevent monotony
          float hueShift = sin(t * 0.1) * 0.1;
          finalColor.r = clamp(finalColor.r + hueShift, 0.0, 1.0);
          finalColor.b = clamp(finalColor.b - hueShift * 0.5, 0.0, 1.0);
          
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Animation loop
    let startTime = Date.now();
    const animate = () => {
      const elapsedTime = (Date.now() - startTime) / 1000;
      material.uniforms.time.value = elapsedTime;
      renderer.render(scene, camera);
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animate();

    // Handle window resize
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height);
      material.uniforms.resolution.value.set(width, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (launchProgressRafRef.current) {
        cancelAnimationFrame(launchProgressRafRef.current);
        launchProgressRafRef.current = null;
      }
      if (launchCompleteTimerRef.current) {
        clearTimeout(launchCompleteTimerRef.current);
        launchCompleteTimerRef.current = null;
      }
      renderer.dispose();
      geometry.dispose();
      material.dispose();
    };
  }, []);

  const handleLaunchClick = () => {
    // Kill the landing page WebGL renderer immediately — frees the GPU context
    // so the main app's WebGL initialization doesn't compete with it.
    // Without this, two simultaneous WebGL contexts cause a 12-15s first-shader stall.
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (launchProgressRafRef.current) {
      cancelAnimationFrame(launchProgressRafRef.current);
      launchProgressRafRef.current = null;
    }
    if (launchCompleteTimerRef.current) {
      clearTimeout(launchCompleteTimerRef.current);
      launchCompleteTimerRef.current = null;
    }
    if (landingRendererRef.current) {
      landingRendererRef.current.dispose();
      landingRendererRef.current = null;
    }

    setIsLoading(true);

    // FIX: Reduced from 3000ms fake wait to 600ms — professional, snappy transition.
    // The WebGL app mounts in parallel (see App.tsx pre-mount strategy) so by the
    // time this bar completes the canvas is already initialised and ready to show.
    const totalDuration = 600;
    const startTime = Date.now();

    const updateProgress = () => {
      const elapsed = Date.now() - startTime;
      const linearProgress = Math.min(elapsed / totalDuration, 1);
      // easeOutQuart — fast start, smooth finish; feels responsive not sluggish
      const easedProgress = 1 - Math.pow(1 - linearProgress, 4);
      const progress = easedProgress * 100;

      setLoadingProgress(progress);

      if (progress < 100) {
        launchProgressRafRef.current = requestAnimationFrame(updateProgress);
      } else {
        launchProgressRafRef.current = null;
        // Tiny 100ms hold at 100% so user registers "complete" before transition
        launchCompleteTimerRef.current = setTimeout(() => { onEnter(); }, 100);
      }
    };

    launchProgressRafRef.current = requestAnimationFrame(updateProgress);
  };

  // Landing renderer is disposed manually in handleLaunchClick when user clicks.
  // No timer-based auto-dispose — that was killing the animation after only 400ms.

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Animated gradient background */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ display: 'block' }}
      />

      {/* Content overlay */}
      <div className="relative z-10 flex flex-col items-center justify-center text-center px-8 max-w-4xl min-h-screen">
        {/* Icon + wordmark group — upper center */}
        <div className="flex flex-col items-center gap-6 mt-auto">
          <img 
            src={BlendcraftIcon} 
            alt="Blendcraft Studio Icon" 
            className="drop-shadow-2xl animate-fade-in"
            style={{ 
              height: '300px',
              width: '300px'
            }}
          />
          <BlendcraftLogoSVG
            className="h-14 w-auto drop-shadow-lg animate-fade-in"
          />
        </div>

        {/* CTA group — pushed lower with top margin */}
        <div className="flex flex-col items-center gap-4 mt-24 mb-auto">
          {/* Launch button or loading bar */}
          {!isLoading ? (
            <button
              onClick={handleLaunchClick}
              className="px-8 py-2.5 text-sm rounded-lg shadow-2xl transition-all duration-300 hover:scale-105 bg-zinc-700/90 backdrop-blur-md border border-white/20 hover:bg-zinc-600/90 text-white font-medium"
            >
              Launch Studio
            </button>
          ) : (
            <div className="w-80">
              <div className="h-3 bg-white/10 backdrop-blur-md border border-white/20 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-none"
                  style={{ width: `${loadingProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Tagline */}
          <h2 className="text-xl font-light text-zinc-100 drop-shadow-lg max-w-md">
            Professional Design Studio
          </h2>
        </div>
      </div>

      {/* Footer badge */}
      <div className="absolute bottom-6 left-0 right-0 z-10 text-center">
        <div className="text-sm text-zinc-400 drop-shadow">
          Made by SPLNTR . Beta v1.0 . Built with a WebGL-powered engine & shader system.
        </div>
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fade-in {
          animation: fade-in 1s ease-out;
        }
      `}</style>
    </div>
  );
}