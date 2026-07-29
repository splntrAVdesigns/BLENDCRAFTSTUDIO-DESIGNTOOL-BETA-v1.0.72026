import { Resolution } from '../types/gradient';

export const RESOLUTION_PRESETS: Resolution[] = [
  // Standard
  { name: 'HD (1920x1080)',       width: 1920, height: 1080, category: 'standard' },
  { name: 'Full HD (2560x1440)', width: 2560, height: 1440, category: 'standard' },
  { name: '4K (3840x2160)',       width: 3840, height: 2160, category: 'standard' },
  { name: 'Square (1080x1080)',   width: 1080, height: 1080, category: 'standard' },
  { name: 'Desktop (1440x900)',   width: 1440, height:  900, category: 'standard' },

  // Social — AR-labelled presets first (users know the ratio they need),
  // then unique platform sizes that have no AR duplicate above.
  { name: '1:1  — Square (1080×1080)',          width: 1080, height: 1080, category: 'social' },
  { name: '4:5  — Portrait (1080×1350)',         width: 1080, height: 1350, category: 'social' },
  { name: '5:4  — Landscape (1350×1080)',        width: 1350, height: 1080, category: 'social' },
  { name: '3:4  — Portrait (810×1080)',          width:  810, height: 1080, category: 'social' },
  { name: '4:3  — Landscape (1440×1080)',        width: 1440, height: 1080, category: 'social' },
  { name: '3:2  — Landscape (1620×1080)',        width: 1620, height: 1080, category: 'social' },
  { name: '2:3  — Portrait (1080×1620)',         width: 1080, height: 1620, category: 'social' },
  { name: '16:9 — Landscape (1920×1080)',        width: 1920, height: 1080, category: 'social' },
  { name: '9:16 — Portrait / Story (1080×1920)', width: 1080, height: 1920, category: 'social' },
  // Unique platform sizes (no AR duplicate above)
  { name: 'Twitter Post (1200×675)',    width: 1200, height:  675, category: 'social' },
  { name: 'Twitter Header (1500×500)', width: 1500, height:  500, category: 'social' },
  { name: 'Facebook Cover (820×312)',  width:  820, height:  312, category: 'social' },
  { name: 'YouTube Thumbnail (1280×720)', width: 1280, height: 720, category: 'social' },
  { name: 'LinkedIn Banner (1584×396)', width: 1584, height:  396, category: 'social' },
  { name: 'Pinterest Pin (1000×1500)', width: 1000, height: 1500, category: 'social' },

  // Print
  { name: 'A4 (2480x3508)',           width: 2480, height: 3508, category: 'print' },
  { name: 'Letter (2550x3300)',        width: 2550, height: 3300, category: 'print' },
  { name: 'Business Card (1050x600)', width: 1050, height:  600, category: 'print' },
];

export const DEFAULT_RESOLUTION = RESOLUTION_PRESETS[0];