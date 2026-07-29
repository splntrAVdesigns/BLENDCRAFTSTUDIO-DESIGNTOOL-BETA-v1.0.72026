import * as THREE from '../../lib/three';
import { Layer, CanvasSettings } from '../../types/gradient';
import { getPatternCanvas, createPatternThreeTexture } from '../../utils/texturePatternCache';

interface SyncShapePatternTexturesOptions {
  layers: Layer[];
  canvasSettings: CanvasSettings;
  patternTextures: Map<string, THREE.Texture>;
  meshes: THREE.Mesh[];
  getVisibleLayers: () => Layer[];
  isCancelled: () => boolean;
  onTextureVersionChange: () => void;
  onNeedsRender: () => void;
  invalidate: () => void;
}

function disposePatternTexture(patternTextures: Map<string, THREE.Texture>, layerId: string) {
  const existing = patternTextures.get(layerId);
  if (existing) {
    existing.dispose();
    patternTextures.delete(layerId);
  }
}

async function loadShapePatternTexture(layer: Layer, options: SyncShapePatternTexturesOptions) {
  const {
    canvasSettings,
    patternTextures,
    meshes,
    getVisibleLayers,
    isCancelled,
    onTextureVersionChange,
    onNeedsRender,
    invalidate,
  } = options;

  if (isCancelled() || !layer.texture || layer.texture.type !== 'shape-pattern') return;

  try {
    // Static import keeps Vite/Figma Make bundling reliable for shape-pattern textures.
    // canvasSettings args removed — patternRenderer always uses 1024×1024 POT;
    // canvas dimensions are no longer baked into the texture.
    const patternCanvas = await getPatternCanvas(layer.texture);
    if (!patternCanvas || isCancelled()) return;

    const texture = await createPatternThreeTexture(patternCanvas);
    if (isCancelled()) {
      texture.dispose();
      return;
    }

    disposePatternTexture(patternTextures, layer.id);
    patternTextures.set(layer.id, texture);

    // Direct uniform write — search by layer.id, not array index.
    const visibleLayers = getVisibleLayers();
    const layerIndex = visibleLayers.findIndex(candidate => candidate.id === layer.id);
    if (layerIndex !== -1 && meshes[layerIndex]) {
      const material = meshes[layerIndex].material as THREE.ShaderMaterial;
      if (material?.uniforms?.uPatternTexture) {
        texture.needsUpdate = true;
        material.uniforms.uPatternTexture.value = texture;
        // Force THREE.js to re-bind all uniforms for this material.
        // Without this, the texture upload to GPU may be deferred and the sampler
        // sees the old null binding on the first render.
        material.needsUpdate = true;
      }
      if (material?.uniforms?.uPatternAR) {
        material.uniforms.uPatternAR.value = canvasSettings.width / canvasSettings.height;
      }
    }

    // Bump version so the uniform update effect re-syncs on the next React render.
    onTextureVersionChange();
    onNeedsRender();
    invalidate();
  } catch (error) {
    console.error(`Failed to load pattern texture for layer ${layer.id}:`, error);
  }
}

export function syncShapePatternTexturesForLayers(options: SyncShapePatternTexturesOptions) {
  const { layers, patternTextures } = options;

  layers.forEach(layer => {
    if (layer.visible && layer.texture?.type === 'shape-pattern') {
      void loadShapePatternTexture(layer, options);
    } else {
      disposePatternTexture(patternTextures, layer.id);
    }
  });

  // Clean up orphaned pattern textures and layers no longer using shape-pattern.
  const layerIds = new Set(layers.map(layer => layer.id));
  Array.from(patternTextures.keys()).forEach(id => {
    const layerStillExists = layerIds.has(id);
    const layer = layers.find(candidate => candidate.id === id);
    const stillShapePattern = layer?.texture?.type === 'shape-pattern';

    if (!layerStillExists || !stillShapePattern) {
      disposePatternTexture(patternTextures, id);
    }
  });
}