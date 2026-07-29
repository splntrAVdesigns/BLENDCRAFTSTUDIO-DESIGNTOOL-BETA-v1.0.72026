/**
 * SVG Validation Utility
 * Validates and extracts data from SVG files for mask system.
 * Beta hardening: rejects unsafe external references, executable SVG features,
 * oversized/complex vector payloads, and suspicious data URL abuse before rasterizing.
 */

import { UPLOAD_LIMITS } from './uploadValidation';

export interface SvgValidationResult {
  isValid: boolean;
  error?: string;
  paths?: string[];
  viewBox?: { x: number; y: number; width: number; height: number };
  width?: number;
  height?: number;
}

const BLOCKED_TAGS = [
  'script',
  'foreignObject',
  'iframe',
  'object',
  'embed',
  'video',
  'audio',
  'canvas',
  'link',
  'meta',
  'style',
];

const UNSAFE_REFERENCE_PATTERN = /(?:href|xlink:href|src)\s*=\s*['"]\s*(?!#)(?:https?:|data:|file:|blob:|\/\/)/i;
const EVENT_HANDLER_PATTERN = /\son[a-z]+\s*=\s*(['"]).*?\1/gi;
const JAVASCRIPT_PATTERN = /javascript\s*:/i;
const CSS_URL_PATTERN = /url\s*\(\s*['"]?\s*(?:https?:|data:|file:|blob:|\/\/|javascript:)/i;

function countSvgElements(svgText: string): number {
  return (svgText.match(/<\s*[a-zA-Z][\w:-]*(?:\s|>|\/)/g) || []).length;
}

function getTotalPathChars(svgText: string): number {
  let total = 0;
  const pathMatches = svgText.matchAll(/<path[^>]*d\s*=\s*["']([^"']+)["'][^>]*>/gi);
  for (const match of pathMatches) total += match[1].length;
  return total;
}

function getUnsafeReason(svgText: string): string | null {
  const trimmed = svgText.trim();
  if (!trimmed) return 'SVG is empty.';
  if (trimmed.length > UPLOAD_LIMITS.svgMaxBytes) return 'SVG file is too large. Max size is 500KB.';
  if (!/<svg[\s>]/i.test(trimmed)) return 'File does not contain valid SVG markup.';

  for (const tag of BLOCKED_TAGS) {
    if (new RegExp(`<\\s*${tag}(?:\\s|>|/)`, 'i').test(trimmed)) {
      return `SVG contains unsupported <${tag}> content.`;
    }
  }

  if (EVENT_HANDLER_PATTERN.test(trimmed)) return 'SVG contains inline event handlers.';
  EVENT_HANDLER_PATTERN.lastIndex = 0;
  if (JAVASCRIPT_PATTERN.test(trimmed)) return 'SVG contains a javascript: URL.';
  if (UNSAFE_REFERENCE_PATTERN.test(trimmed)) return 'SVG contains an external or embedded reference.';
  if (CSS_URL_PATTERN.test(trimmed)) return 'SVG contains an unsafe CSS url() reference.';
  if ((trimmed.match(/data:/gi) || []).join('').length > 0) return 'SVG contains embedded data URLs.';
  if (countSvgElements(trimmed) > UPLOAD_LIMITS.maxSvgElements) return 'SVG is too complex for beta mask import.';
  if (getTotalPathChars(trimmed) > UPLOAD_LIMITS.maxSvgPathChars) return 'SVG path data is too complex for beta mask import.';

  return null;
}

/**
 * Validate SVG content and extract useful data
 * @param svgText - Raw SVG file content
 * @returns SvgValidationResult
 */
export function validateSVG(svgText: string): SvgValidationResult {
  try {
    const unsafeReason = getUnsafeReason(svgText);
    if (unsafeReason) {
      return { isValid: false, error: unsafeReason };
    }

    // Parse viewBox
    const viewBoxMatch = svgText.match(/viewBox\s*=\s*["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
    const viewBox = viewBoxMatch
      ? {
          x: parseFloat(viewBoxMatch[1]),
          y: parseFloat(viewBoxMatch[2]),
          width: parseFloat(viewBoxMatch[3]),
          height: parseFloat(viewBoxMatch[4]),
        }
      : undefined;

    if (viewBox && (!Number.isFinite(viewBox.width) || !Number.isFinite(viewBox.height) || viewBox.width <= 0 || viewBox.height <= 0)) {
      return { isValid: false, error: 'SVG viewBox dimensions are invalid.' };
    }

    // Parse width and height attributes
    const widthMatch = svgText.match(/width\s*=\s*["']?([-\d.]+)/i);
    const heightMatch = svgText.match(/height\s*=\s*["']?([-\d.]+)/i);
    const width = widthMatch ? parseFloat(widthMatch[1]) : undefined;
    const height = heightMatch ? parseFloat(heightMatch[1]) : undefined;

    if ((width !== undefined && (!Number.isFinite(width) || width <= 0)) ||
        (height !== undefined && (!Number.isFinite(height) || height <= 0))) {
      return { isValid: false, error: 'SVG width/height attributes are invalid.' };
    }

    // Extract all path elements
    const pathMatches = svgText.matchAll(/<path[^>]*d\s*=\s*["']([^"']+)["'][^>]*>/gi);
    const paths: string[] = [];
    for (const match of pathMatches) {
      paths.push(match[1]);
    }

    // Check for common issues
    if (paths.length === 0) {
      return {
        isValid: false,
        error: 'SVG does not contain any path elements',
      };
    }

    if (!viewBox && (!width || !height)) {
      return {
        isValid: false,
        error: 'SVG must have viewBox or width/height attributes',
      };
    }

    return {
      isValid: true,
      paths,
      viewBox,
      width,
      height,
    };
  } catch (error) {
    return {
      isValid: false,
      error: `Failed to parse SVG: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Extract primary path from SVG
 * @param svgText - Raw SVG content
 * @returns string | null - First path found or null
 */
export function extractPrimaryPath(svgText: string): string | null {
  const result = validateSVG(svgText);
  return result.paths && result.paths.length > 0 ? result.paths[0] : null;
}

/**
 * Sanitize SVG content for security
 * @param svgText - Raw SVG content
 * @returns string - Sanitized SVG
 */
export function sanitizeSVG(svgText: string): string {
  let sanitized = svgText.trim();

  // Remove XML processing instructions and comments.
  sanitized = sanitized.replace(/<\?xml[\s\S]*?\?>/gi, '');
  sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, '');

  // Remove blocked tag blocks and self-closing blocked tags.
  for (const tag of BLOCKED_TAGS) {
    const blockPattern = new RegExp(`<\\s*${tag}\\b[\\s\\S]*?<\\s*\\/\\s*${tag}\\s*>`, 'gi');
    const selfClosingPattern = new RegExp(`<\\s*${tag}\\b[^>]*\\/\\s*>`, 'gi');
    sanitized = sanitized.replace(blockPattern, '').replace(selfClosingPattern, '');
  }

  // Remove event handlers and unsafe URL protocols/references.
  sanitized = sanitized.replace(EVENT_HANDLER_PATTERN, '');
  EVENT_HANDLER_PATTERN.lastIndex = 0;
  sanitized = sanitized.replace(/\s(?:href|xlink:href|src)\s*=\s*(['"])\s*(?!#)(?:https?:|data:|file:|blob:|\/\/)[\s\S]*?\1/gi, '');
  sanitized = sanitized.replace(/javascript\s*:/gi, '');
  sanitized = sanitized.replace(/url\s*\(\s*(['"]?)\s*(?:https?:|data:|file:|blob:|\/\/|javascript:)[\s\S]*?\)/gi, 'none');

  return sanitized;
}

/**
 * Check if SVG file size is reasonable
 * @param svgText - Raw SVG content
 * @param maxSizeKB - Maximum size in KB (default: 500KB)
 * @returns boolean
 */
export function checkSVGSize(svgText: string, maxSizeKB: number = 500): boolean {
  const sizeKB = new Blob([svgText]).size / 1024;
  return sizeKB <= maxSizeKB;
}