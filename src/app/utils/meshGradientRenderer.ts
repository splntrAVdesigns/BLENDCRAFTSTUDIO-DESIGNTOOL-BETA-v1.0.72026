import * as THREE from '../lib/three';
import type { GradientConfig } from '../types/gradient';

/**
 * Generate a true mesh gradient with Voronoi-like interpolation
 * Similar to CSS mesh gradients or tools like MeshGradient.com
 */
export function createMeshGradientShader(config: GradientConfig): {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
} {
  // Default mesh points if not provided
  const meshPoints = config.meshPoints || generateDefaultMeshPoints();
  
  const vertexShader = `
    varying vec2 vUv;
    
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  // Generate mesh points uniforms
  const pointsArray: number[] = [];
  const colorsArray: number[] = [];
  
  meshPoints.forEach(point => {
    pointsArray.push(point.x, point.y);
    const color = new THREE.Color(point.color);
    colorsArray.push(color.r, color.g, color.b);
  });

  const fragmentShader = `
    precision highp float;
    
    varying vec2 vUv;
    uniform vec2 uMeshPoints[${meshPoints.length}];
    uniform vec3 uMeshColors[${meshPoints.length}];
    uniform float uIntensity;
    uniform float uScale;
    uniform float uTime;
    
    // Animation uniforms
    uniform float uRotation;
    uniform float uDriftX;
    uniform float uDriftY;
    uniform float uPulse;
    uniform float uTurbulence;
    uniform float uTwist;
    
    // Interactive mode uniforms
    uniform float mouseX;
    uniform float mouseY;
    uniform float mouseIntensity;
    
    // Noise function for turbulence
    float random(vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }
    
    float noise(vec2 st) {
      vec2 i = floor(st);
      vec2 f = fract(st);
      
      float a = fract(sin(dot(i, vec2(12.9898, 78.233))) * 43758.5453);
      float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(12.9898, 78.233))) * 43758.5453);
      float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
      float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
      
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }
    
    // Smooth distance function for better color blending
    float smoothDistance(vec2 p1, vec2 p2) {
      float dist = distance(p1, p2);
      return 1.0 / (1.0 + dist * dist * uScale * 10.0);
    }
    
    // Voronoi-like color interpolation
    vec3 meshInterpolation(vec2 uv) {
      vec3 finalColor = vec3(0.0);
      float totalWeight = 0.0;
      
      // Calculate weighted color based on distance to each point
      for (int i = 0; i < ${meshPoints.length}; i++) {
        vec2 point = uMeshPoints[i];
        
        // Add subtle animation
        point.x += sin(uTime * 0.5 + float(i)) * 0.02;
        point.y += cos(uTime * 0.5 + float(i)) * 0.02;
        
        float weight = smoothDistance(uv, point);
        finalColor += uMeshColors[i] * weight;
        totalWeight += weight;
      }
      
      // Normalize
      if (totalWeight > 0.0) {
        finalColor /= totalWeight;
      }
      
      return finalColor;
    }
    
    void main() {
      // Apply drift
      vec2 animatedUV = vUv + vec2(uDriftX, uDriftY);
      
      // Apply turbulence
      if (uTurbulence > 0.01) {
        animatedUV.x += noise(animatedUV * 5.0 + uTime) * uTurbulence * 0.1;
        animatedUV.y += noise(animatedUV * 5.0 - uTime) * uTurbulence * 0.1;
      }
      
      // Apply twist
      vec2 toCenter = animatedUV - vec2(0.5);
      float dist = length(toCenter);
      if (uTwist > 0.01 && dist > 0.001) {
        float twistAngle = dist * uTwist * 3.14159;
        float cosT = cos(twistAngle);
        float sinT = sin(twistAngle);
        toCenter = vec2(
          toCenter.x * cosT - toCenter.y * sinT,
          toCenter.x * sinT + toCenter.y * cosT
        );
      }
      animatedUV = toCenter + vec2(0.5);
      
      // Apply rotation
      toCenter = animatedUV - vec2(0.5);
      float rotRad = radians(uRotation);
      float cosR = cos(rotRad);
      float sinR = sin(rotRad);
      vec2 rotated = vec2(
        toCenter.x * cosR - toCenter.y * sinR,
        toCenter.x * sinR + toCenter.y * cosR
      ) + vec2(0.5);
      
      // Get mesh gradient color
      vec3 color = meshInterpolation(rotated);
      
      // Apply intensity and pulse
      color = mix(vec3(0.5), color, uIntensity * uPulse);
      
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const uniforms: Record<string, THREE.IUniform> = {
    uMeshPoints: { value: meshPoints.map(p => new THREE.Vector2(p.x, p.y)) },
    uMeshColors: { value: meshPoints.map(p => new THREE.Color(p.color)) },
    uIntensity: { value: config.intensity || 1.0 },
    uScale: { value: config.scale || 1.0 },
    uTime: { value: 0 },
    // Animation uniforms
    uRotation: { value: 0 },
    uDriftX: { value: 0 },
    uDriftY: { value: 0 },
    uPulse: { value: 1.0 },
    uTurbulence: { value: 0 },
    uTwist: { value: 0 },
    // Interactive uniforms
    mouseX: { value: 0 },
    mouseY: { value: 0 },
    mouseIntensity: { value: 0 },
  };

  return { vertexShader, fragmentShader, uniforms };
}

/**
 * Generate default mesh gradient points in a grid pattern
 */
function generateDefaultMeshPoints(): Array<{ x: number; y: number; color: string }> {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7B801'];
  const points: Array<{ x: number; y: number; color: string }> = [];
  
  // Create a 3x3 grid of points
  const rows = 3;
  const cols = 3;
  
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = (col / (cols - 1)) * 0.8 + 0.1; // Add padding
      const y = (row / (rows - 1)) * 0.8 + 0.1;
      const colorIndex = (row * cols + col) % colors.length;
      
      points.push({
        x,
        y,
        color: colors[colorIndex],
      });
    }
  }
  
  return points;
}

/**
 * Create an editable mesh gradient with control points
 */
export function createEditableMeshGradient(
  config: GradientConfig,
  onPointUpdate?: (points: Array<{ x: number; y: number; color: string }>) => void
): {
  mesh: THREE.Mesh;
  controlPoints: Array<{ position: THREE.Vector2; color: string; element?: HTMLElement }>;
} {
  const { vertexShader, fragmentShader, uniforms } = createMeshGradientShader(config);
  
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
  });
  
  const mesh = new THREE.Mesh(geometry, material);
  
  const meshPoints = config.meshPoints || generateDefaultMeshPoints();
  const controlPoints = meshPoints.map(point => ({
    position: new THREE.Vector2(point.x, point.y),
    color: point.color,
  }));
  
  return { mesh, controlPoints };
}

/**
 * Update mesh gradient animation
 */
export function updateMeshGradientAnimation(
  mesh: THREE.Mesh,
  deltaTime: number
) {
  const material = mesh.material as THREE.ShaderMaterial;
  if (material.uniforms.uTime) {
    material.uniforms.uTime.value += deltaTime * 0.001; // Convert to seconds
  }
}

/**
 * Advanced mesh gradient with smooth Laplacian interpolation
 */
export function createAdvancedMeshGradient(config: GradientConfig): THREE.Mesh {
  const meshPoints = config.meshPoints || generateDefaultMeshPoints();
  
  // Create a higher resolution grid for smoother interpolation
  const resolution = 64;
  const geometry = new THREE.PlaneGeometry(2, 2, resolution, resolution);
  
  // Calculate vertex colors using Laplacian smoothing
  const positions = geometry.attributes.position;
  const colors: number[] = [];
  
  for (let i = 0; i < positions.count; i++) {
    const x = (positions.getX(i) + 1) / 2; // Convert from [-1, 1] to [0, 1]
    const y = (positions.getY(i) + 1) / 2;
    
    // Find closest mesh points and blend
    let finalColor = new THREE.Color(0, 0, 0);
    let totalWeight = 0;
    
    meshPoints.forEach(point => {
      const dist = Math.sqrt(
        Math.pow(x - point.x, 2) + Math.pow(y - point.y, 2)
      );
      const weight = 1 / (1 + dist * dist * (config.scale || 1) * 10);
      const color = new THREE.Color(point.color);
      
      finalColor.r += color.r * weight;
      finalColor.g += color.g * weight;
      finalColor.b += color.b * weight;
      totalWeight += weight;
    });
    
    if (totalWeight > 0) {
      finalColor.r /= totalWeight;
      finalColor.g /= totalWeight;
      finalColor.b /= totalWeight;
    }
    
    colors.push(finalColor.r, finalColor.g, finalColor.b);
  }
  
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
  });
  
  return new THREE.Mesh(geometry, material);
}
