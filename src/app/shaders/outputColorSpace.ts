/**
 * Adds Three.js' renderer-selected output transfer at the end of a custom
 * fragment shader. When rendering into a Linear-sRGB target the generated
 * conversion is an identity; when rendering to the presentation canvas it
 * converts the linear working result to the renderer's sRGB output space.
 */
export function withOutputColorSpace(fragmentShader: string): string {
  if (fragmentShader.includes('#include <colorspace_fragment>')) return fragmentShader;

  const mainEnd = fragmentShader.lastIndexOf('}');
  if (mainEnd < 0 || !fragmentShader.includes('void main')) {
    throw new Error('Cannot apply output color space to a fragment shader without main().');
  }

  return `${fragmentShader.slice(0, mainEnd)}\n  #include <colorspace_fragment>\n${fragmentShader.slice(mainEnd)}`;
}
