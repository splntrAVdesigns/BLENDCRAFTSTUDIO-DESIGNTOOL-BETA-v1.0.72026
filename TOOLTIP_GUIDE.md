# Tooltip Implementation Guide

## How to Add Tooltips to Components

The tooltip system in Blendcraft Studio uses a global toggle that allows users to enable/disable all tooltips from the header.

### Quick Start

1. **Import the ConditionalTooltip component:**
```tsx
import { ConditionalTooltip } from '../ui/ConditionalTooltip';
```

2. **Wrap your component:**
```tsx
<ConditionalTooltip content="Your helpful tooltip text">
  <YourComponent />
</ConditionalTooltip>
```

### Examples

#### Basic Usage (Button)
```tsx
<ConditionalTooltip content="Click to export your gradient">
  <Button onClick={handleExport}>
    <Download className="w-4 h-4" />
    Export
  </Button>
</ConditionalTooltip>
```

#### Label Tooltip
```tsx
<ConditionalTooltip content="Adjust the blur amount for soft effects">
  <Label className="text-xs text-zinc-400">Blur</Label>
</ConditionalTooltip>
```

#### Select/Dropdown Tooltip
```tsx
<ConditionalTooltip content="Choose from 14 gradient types">
  <Select value={gradient.type} onValueChange={handleChange}>
    <SelectTrigger>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {/* options */}
    </SelectContent>
  </Select>
</ConditionalTooltip>
```

#### Custom Positioning
```tsx
<ConditionalTooltip 
  content="This appears on the right" 
  side="right"
  align="start"
>
  <Button>Hover me</Button>
</ConditionalTooltip>
```

### Props

- `content` (string, required): The tooltip text
- `side` ('top' | 'right' | 'bottom' | 'left', default: 'top'): Position relative to element
- `align` ('start' | 'center' | 'end', default: 'center'): Alignment along the side
- `delayDuration` (number, default: 300): Delay before showing tooltip in ms

### Best Practices

1. **Be Concise**: Keep tooltip text short and helpful
   - ✅ "Apply Gaussian blur for soft effects"
   - ❌ "This slider allows you to apply a Gaussian blur effect which will make your gradient look softer and more dreamy by averaging pixel values"

2. **Add Value**: Only add tooltips where they provide useful information
   - ✅ Complex controls, keyboard shortcuts, non-obvious features
   - ❌ Obvious buttons like "Save" or "Cancel"

3. **Use Active Voice**: Make it actionable
   - ✅ "Drag to reorder layers"
   - ❌ "Layers can be reordered by dragging"

4. **Include Shortcuts**: Mention keyboard shortcuts when relevant
   - ✅ "Export gradient (CMD+E)"
   - ❌ "Export gradient"

### Where to Add Tooltips

**High Priority:**
- Complex gradient controls (mesh points, wave frequency, etc.)
- Effect sliders (blur, vignette, chromatic aberration)
- Layer operations (blend modes, opacity)
- Animation settings (easing curves, duration)
- Export options (format, quality, resolution)

**Medium Priority:**
- Texture controls
- Color stop management
- Canvas settings
- Preset buttons

**Low Priority:**
- Basic buttons with clear labels
- Simple on/off switches
- Standard UI elements

### Toggling Tooltips

Users can toggle tooltips on/off from the header:
- Switch labeled "Tooltips" in the header
- State persists in localStorage
- All ConditionalTooltip components respect this setting

### Testing

To test your tooltips:
1. Ensure tooltips are enabled (check header switch)
2. Hover over your component
3. Tooltip should appear after 300ms
4. Toggle tooltips off in header
5. Tooltip should NOT appear
6. Refresh page - setting should persist

### Architecture

```
TooltipContext (global state)
    ↓
TooltipProvider (wraps app)
    ↓
useTooltipContext() hook
    ↓
ConditionalTooltip (wrapper component)
    ↓
Your component
```

The system is centralized, making it easy to:
- Add new tooltips anywhere
- Toggle all tooltips globally
- Persist user preference
- Maintain consistent behavior
