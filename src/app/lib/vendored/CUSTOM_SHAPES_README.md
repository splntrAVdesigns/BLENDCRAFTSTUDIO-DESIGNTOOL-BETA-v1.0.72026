# Custom Shapes Integration Guide

This directory contains custom SVG shapes that can be added to the Mask Shape Library.

## How to Add Custom Shapes

### Step 1: Prepare Your SVG Files

1. Place your SVG files in this directory (`src/app/lib/vendored/`)
2. Ensure SVGs meet these requirements:
   - ✅ Clean path data (no embedded styles or transforms)
   - ✅ Normalized viewBox (preferably `viewBox="0 0 100 100"`)
   - ✅ Single path or compound paths that work together
   - ✅ Transparent background
   - ✅ Under 500KB per file

### Step 2: Extract SVG Path Data

From your SVG file, extract the `d` attribute from the `<path>` element:

```xml
<!-- Example SVG file -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M 10 50 L 50 10 L 90 50 L 50 90 Z" fill="white"/>
</svg>
```

The path data you need: `M 10 50 L 50 10 L 90 50 L 50 90 Z`

### Step 3: Add to maskShapes.ts

Open `/src/app/lib/maskShapes.ts` and add your shape to the `CUSTOM_SHAPES` array:

```typescript
const CUSTOM_SHAPES: ShapePreset[] = [
  {
    id: 'custom-diamond-arrow',           // Unique ID (use kebab-case)
    name: 'Diamond Arrow',                 // Display name
    category: 'custom',                    // Always 'custom'
    svgPath: 'M 10 50 L 50 10 L 90 50 L 50 90 Z', // Path data
    viewBox: { x: 0, y: 0, w: 100, h: 100 }, // ViewBox from SVG
    complexity: 'simple',                  // 'simple' or 'detailed'
    renderMode: 'wireframe',               // 'fill' or 'wireframe'
    defaultStrokeWidth: 3,                 // 1-20 (for wireframe only)
    description: 'Professional diamond arrow', // Optional description
    tags: ['arrow', 'navigation'],         // Optional tags for search
  },
  // Add more shapes here...
];
```

### Step 4: Test Your Shape

1. Save the file
2. Open the app and navigate to Mask Settings
3. Click "Show Shape Library"
4. Scroll to the "Custom Shapes" section
5. Your shape should appear with a cyan border

## Shape Properties Reference

### Required Properties

- **id**: Unique identifier (kebab-case recommended)
  - Example: `'custom-star-burst'`, `'custom-arrow-curved'`

- **name**: Human-readable name shown in tooltip
  - Example: `'Star Burst'`, `'Curved Arrow'`

- **category**: Always set to `'custom'` for custom shapes

- **svgPath**: The SVG path `d` attribute value
  - Should be clean path commands (M, L, C, Q, A, Z, etc.)

- **viewBox**: The coordinate system for the SVG
  ```typescript
  { x: 0, y: 0, w: 100, h: 100 }  // Standard normalized viewBox
  ```

- **complexity**: Rendering resolution hint
  - `'simple'`: Basic shapes, renders at 2048px
  - `'detailed'`: Complex shapes, renders at 4096px

- **renderMode**: How the shape is rendered
  - `'fill'`: Solid filled shape
  - `'wireframe'`: Stroke outline only

### Optional Properties

- **defaultStrokeWidth**: Stroke width for wireframe shapes (1-20)
  - Only applies when `renderMode: 'wireframe'`
  - Default: 3
  - Thinner lines (1-2): Delicate details
  - Medium lines (3-5): Standard icons
  - Thick lines (6-10): Bold graphics

- **description**: Short description shown in extended tooltip
  - Useful for explaining what the icon represents

- **tags**: Array of keywords for future search/filter functionality
  ```typescript
  tags: ['arrow', 'direction', 'navigation', 'ui']
  ```

## Examples

### Example 1: Filled Custom Shape

```typescript
{
  id: 'custom-logo-icon',
  name: 'Company Logo',
  category: 'custom',
  svgPath: 'M 50 10 L 90 50 L 50 90 L 10 50 Z M 50 30 L 70 50 L 50 70 L 30 50 Z',
  viewBox: { x: 0, y: 0, w: 100, h: 100 },
  complexity: 'simple',
  renderMode: 'fill',
  description: 'Custom company logo mark',
  tags: ['branding', 'logo'],
}
```

### Example 2: Wireframe Custom Shape

```typescript
{
  id: 'custom-tech-circuit',
  name: 'Circuit Pattern',
  category: 'custom',
  svgPath: 'M 20 20 L 80 20 L 80 40 L 60 40 L 60 60 L 80 60 L 80 80 L 20 80 Z',
  viewBox: { x: 0, y: 0, w: 100, h: 100 },
  complexity: 'detailed',
  renderMode: 'wireframe',
  defaultStrokeWidth: 2,
  description: 'Tech circuit board pattern',
  tags: ['technology', 'electronic', 'modern'],
}
```

### Example 3: Complex Detailed Shape

```typescript
{
  id: 'custom-ornate-frame',
  name: 'Ornate Frame',
  category: 'custom',
  svgPath: 'M 10 10 Q 30 5 50 10 Q 70 5 90 10 L 90 30 Q 95 50 90 70 L 90 90 Q 70 95 50 90 Q 30 95 10 90 L 10 70 Q 5 50 10 30 Z M 25 25 L 75 25 L 75 75 L 25 75 Z',
  viewBox: { x: 0, y: 0, w: 100, h: 100 },
  complexity: 'detailed',
  renderMode: 'fill',
  description: 'Decorative ornate frame border',
  tags: ['decorative', 'frame', 'border', 'vintage'],
}
```

## Tips for Best Results

### Choosing Complexity

- Use `'simple'` for:
  - Basic geometric shapes
  - Icons with fewer than 10 path commands
  - Shapes that will be used small

- Use `'detailed'` for:
  - Complex illustrations
  - Shapes with curves and many points
  - Large shapes that need crisp edges

### Choosing Render Mode

- Use `'fill'` for:
  - Solid logos and icons
  - Shapes where negative space matters
  - Silhouettes

- Use `'wireframe'` for:
  - Line-art icons
  - Technical diagrams
  - Minimalist designs
  - When you want the gradient to show through

### ViewBox Normalization

If your SVG has a non-standard viewBox like `viewBox="0 0 512 512"`, it will still work, but for consistency consider:

1. Normalizing to `0 0 100 100` if possible
2. Keeping the original aspect ratio in the viewBox
3. Using the exact viewBox from your source SVG file

### Path Optimization

For best performance:
- Simplify paths in vector editor before export
- Remove unnecessary decimal precision
- Combine multiple paths when possible
- Use relative commands (l, c, q) for smaller file size

## Troubleshooting

### Shape Not Appearing
- Check that `category: 'custom'` is set correctly
- Verify the shape is inside the `CUSTOM_SHAPES` array
- Ensure no duplicate IDs with existing shapes

### Shape Renders Incorrectly
- Verify viewBox coordinates match your path data
- Check that path uses valid SVG commands
- Try switching between 'fill' and 'wireframe' renderMode

### Shape Appears Too Thick/Thin
- Adjust `defaultStrokeWidth` for wireframe shapes
- For fill shapes, the path itself determines thickness
- Users can adjust stroke width in the UI

## File Organization

```
src/app/lib/vendored/
├── .gitkeep
├── CUSTOM_SHAPES_README.md  ← This file
├── icon-arrow.svg            ← Your custom SVG files
├── icon-logo.svg
└── shape-ornament.svg
```

## Next Steps

Once you've added your shapes to `maskShapes.ts`:

1. **Test in UI**: Open Mask Settings → Show Shape Library → Custom Shapes
2. **Verify Rendering**: Click the shape to apply it and check quality
3. **Adjust Stroke Width**: Use the Stroke Width slider for wireframe shapes
4. **Test Animations**: Enable Mask Animation to see it in motion

## Questions?

The shape library supports unlimited custom shapes. You can replace existing symbol glyphs by:

1. Finding the shape ID in `maskShapes.ts`
2. Updating the `svgPath` with your professional version
3. Adjusting properties (complexity, strokeWidth, etc.)

Happy shape building! 🎨
