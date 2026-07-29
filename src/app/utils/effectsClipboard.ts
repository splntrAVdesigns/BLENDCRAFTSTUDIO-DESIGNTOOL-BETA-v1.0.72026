import { EffectsConfig } from '../components/controls/EffectsControls';

const EFFECTS_CLIPBOARD_KEY = 'blendcraft-effects-clipboard';

/**
 * Copy effects to clipboard (stored in localStorage)
 */
export function copyEffects(effects: EffectsConfig): void {
  try {
    const effectsData = JSON.stringify(effects);
    localStorage.setItem(EFFECTS_CLIPBOARD_KEY, effectsData);
  } catch (error) {
    console.error('Failed to copy effects:', error);
    throw new Error('Failed to copy effects to clipboard');
  }
}

/**
 * Paste effects from clipboard
 */
export function pasteEffects(): EffectsConfig | null {
  try {
    const effectsData = localStorage.getItem(EFFECTS_CLIPBOARD_KEY);
    if (!effectsData) {
      return null;
    }
    return JSON.parse(effectsData) as EffectsConfig;
  } catch (error) {
    console.error('Failed to paste effects:', error);
    throw new Error('Failed to paste effects from clipboard');
  }
}

/**
 * Check if there are effects in the clipboard
 */
export function hasEffectsInClipboard(): boolean {
  return localStorage.getItem(EFFECTS_CLIPBOARD_KEY) !== null;
}

/**
 * Clear effects clipboard
 */
export function clearEffectsClipboard(): void {
  localStorage.removeItem(EFFECTS_CLIPBOARD_KEY);
}
