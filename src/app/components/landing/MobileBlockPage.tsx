import { useEffect, useRef } from 'react';
import * as THREE from '../../lib/three';
import { BlendcraftLogoSVG } from '../ui/BlendcraftLogoSVG';
import BlendcraftIcon from 'figma:asset/987cf5f33064a7023b59cef30c3e7f415b485d24.png';
import { AlertCircle } from 'lucide-react';

/**
 * Mobile Block Page
 * Displayed to phone users (< 768px) to inform them the app requires desktop/tablet
 */
export function MobileBlockPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();

  useEffect(() => {
    if (!canvasRef.current) return;

    // Setup Three.js scene for animated gradient background (same as landing page)
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    
    const renderer = new THREE.WebGLRenderer({ 
      canvas: canvasRef.current,
      antialias: true,
      alpha: false
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Create animated gradient shader material (same as landing page)
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
        uniform float time;
        uniform vec2 resolution;
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
          float t = time * 0.15;
          
          // Multiple octaves of noise for rich movement
          float noise1 = snoise(uv * 2.0 + vec2(t, t * 0.5));
          float noise2 = snoise(uv * 3.0 - vec2(t * 0.7, t));
          float noise3 = snoise(uv * 1.5 + vec2(t * 0.3, -t * 0.4));
          
          // Combine noise for complex patterns
          float combinedNoise = (noise1 * 0.5 + noise2 * 0.3 + noise3 * 0.2);
          
          // Create flowing gradient with noise influence
          vec2 flowUV = uv + vec2(combinedNoise * 0.1, combinedNoise * 0.15);
          
          // Beautiful purple-blue-cyan gradient
          vec3 color1 = vec3(0.4, 0.2, 0.8);  // Purple
          vec3 color2 = vec3(0.2, 0.4, 1.0);  // Blue
          vec3 color3 = vec3(0.3, 0.8, 0.9);  // Cyan
          vec3 color4 = vec3(0.1, 0.1, 0.2);  // Dark blue
          
          // Mix colors based on position and noise
          vec3 finalColor = mix(
            mix(color1, color2, flowUV.x + combinedNoise * 0.2),
            mix(color3, color4, flowUV.y - combinedNoise * 0.15),
            (flowUV.x + flowUV.y) * 0.5 + sin(t) * 0.1
          );
          
          // Add subtle glow
          float glow = pow(1.0 - length(uv - 0.5) * 0.8, 2.0);
          finalColor += vec3(0.1, 0.15, 0.3) * glow;
          
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
      const currentTime = Date.now();
      material.uniforms.time.value = (currentTime - startTime) / 1000;
      renderer.render(scene, camera);
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animate();

    // Handle resize
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height);
      material.uniforms.resolution.value.set(width, height);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-zinc-950 overflow-hidden">
      {/* Animated Gradient Background */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />

      {/* Content Overlay */}
      <div className="relative z-10 h-full flex flex-col items-center justify-center p-6 text-center">
        {/* Logo Section */}
        <div className="mb-8 space-y-4">
          {/* Icon */}
          <div className="flex justify-center mb-4">
            <img 
              src={BlendcraftIcon} 
              alt="Blendcraft Studio Icon" 
              className="w-20 h-20 drop-shadow-2xl"
            />
          </div>

          {/* Logo */}
          <div className="flex justify-center">
            <BlendcraftLogoSVG className="h-5 w-auto drop-shadow-2xl" />
          </div>
        </div>

        {/* Alert Icon */}
        <div className="mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 backdrop-blur-sm">
            <AlertCircle className="w-8 h-8 text-amber-400" />
          </div>
        </div>

        {/* Main Message */}
        <div className="max-w-md space-y-6">
          <h1 className="text-2xl font-bold text-white">
            Desktop & Tablet Experience Required
          </h1>

          <p className="text-lg text-zinc-300">
            Blendcraft Studio is a professional gradient tool optimized for larger screens.
          </p>

          {/* Requirements */}
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg p-6 text-left space-y-3">
            <p className="text-sm font-semibold text-cyan-400 mb-3">
              ✓ Supported Devices:
            </p>
            <ul className="space-y-2 text-sm text-zinc-300">
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-0.5">•</span>
                <span>Desktop or laptop computers</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 mt-0.5">•</span>
                <span>iPad & tablets (10"+ screens)</span>
              </li>
            </ul>
          </div>

          {/* Mobile Coming Soon */}
          <div className="bg-blue-500/5 backdrop-blur-sm border border-blue-500/20 rounded-lg p-4">
            <p className="text-sm text-blue-300">
              <span className="font-semibold">📱 Mobile version in development</span>
              <br />
              <span className="text-blue-200/80">
                We're building an amazing mobile experience for iPhone and Android.
              </span>
            </p>
          </div>

          {/* Call to Action */}
          <p className="text-sm text-zinc-400 pt-4">
            Please visit <span className="font-mono text-cyan-400">blendcraft.studio</span> on a desktop or tablet to get started.
          </p>
        </div>

        {/* Footer */}
        <div className="mt-12 text-xs text-zinc-500">
          Thank you for your patience! 🎨
        </div>
      </div>
    </div>
  );
}