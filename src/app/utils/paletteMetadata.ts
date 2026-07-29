/**
 * Palette Metadata System
 * Provides context, use cases, moods, and tags for each color palette
 */

export interface PaletteMetadata {
  name: string;
  description: string;
  useCase: string[];
  mood: string[];
  tags: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  trending?: boolean;
}

export const PALETTE_METADATA: Record<string, PaletteMetadata> = {
  // MONOCHROME
  grays: {
    name: 'Grays',
    description: 'Versatile grayscale palette for minimalist designs',
    useCase: ['backgrounds', 'typography', 'ui-components', 'professional'],
    mood: ['neutral', 'sophisticated', 'calm'],
    tags: ['monochrome', 'minimal', 'classic'],
    difficulty: 'beginner',
  },
  blues: {
    name: 'Blues',
    description: 'Monochromatic blue progression for trust and stability',
    useCase: ['corporate', 'finance', 'healthcare', 'tech'],
    mood: ['trustworthy', 'calm', 'professional'],
    tags: ['monochrome', 'corporate', 'reliable'],
    difficulty: 'beginner',
  },
  reds: {
    name: 'Reds',
    description: 'Monochromatic red progression for energy and passion',
    useCase: ['marketing', 'entertainment', 'food', 'alerts'],
    mood: ['energetic', 'passionate', 'bold'],
    tags: ['monochrome', 'vibrant', 'attention'],
    difficulty: 'beginner',
  },
  greens: {
    name: 'Greens',
    description: 'Monochromatic green for growth and nature',
    useCase: ['environment', 'health', 'finance', 'organic'],
    mood: ['natural', 'balanced', 'growth'],
    tags: ['monochrome', 'nature', 'wellness'],
    difficulty: 'beginner',
  },

  // PASTELS
  cotton: {
    name: 'Cotton',
    description: 'Soft pink pastels reminiscent of cotton candy',
    useCase: ['baby-products', 'beauty', 'feminine', 'gentle-ui'],
    mood: ['gentle', 'sweet', 'delicate'],
    tags: ['pastel', 'pink', 'soft'],
    difficulty: 'beginner',
  },
  mint: {
    name: 'Mint',
    description: 'Refreshing mint green pastel combination',
    useCase: ['wellness', 'spring', 'fresh-brands', 'eco'],
    mood: ['fresh', 'clean', 'calming'],
    tags: ['pastel', 'green', 'refreshing'],
    difficulty: 'beginner',
  },
  lavender: {
    name: 'Lavender',
    description: 'Soothing purple pastels for relaxation',
    useCase: ['spa', 'meditation', 'luxury', 'aromatherapy'],
    mood: ['peaceful', 'luxurious', 'dreamy'],
    tags: ['pastel', 'purple', 'elegant'],
    difficulty: 'beginner',
  },
  peach: {
    name: 'Peach',
    description: 'Warm peach tones for friendly approachability',
    useCase: ['food', 'hospitality', 'lifestyle', 'social'],
    mood: ['warm', 'friendly', 'inviting'],
    tags: ['pastel', 'orange', 'welcoming'],
    difficulty: 'beginner',
  },
  sky: {
    name: 'Sky',
    description: 'Light blue pastels inspired by clear skies',
    useCase: ['travel', 'aviation', 'weather', 'freedom'],
    mood: ['airy', 'open', 'peaceful'],
    tags: ['pastel', 'blue', 'sky'],
    difficulty: 'beginner',
  },
  rose: {
    name: 'Rose',
    description: 'Romantic rose pink pastels',
    useCase: ['weddings', 'romance', 'flowers', 'beauty'],
    mood: ['romantic', 'elegant', 'soft'],
    tags: ['pastel', 'pink', 'romantic'],
    difficulty: 'beginner',
  },
  sunrise: {
    name: 'Sunrise',
    description: 'Warm sunrise gradient from yellow to pink',
    useCase: ['morning', 'energy', 'optimism', 'new-beginnings'],
    mood: ['hopeful', 'energizing', 'warm'],
    tags: ['pastel', 'sunrise', 'gradient'],
    difficulty: 'beginner',
  },
  coral: {
    name: 'Coral',
    description: 'Vibrant coral pink for tropical vibes',
    useCase: ['beach', 'summer', 'tropical', 'vacation'],
    mood: ['tropical', 'vibrant', 'playful'],
    tags: ['pastel', 'coral', 'beach'],
    difficulty: 'beginner',
  },

  // VIBRANT
  sunset: {
    name: 'Sunset',
    description: 'Dramatic sunset colors from red to orange',
    useCase: ['photography', 'travel', 'adventure', 'inspiration'],
    mood: ['dramatic', 'warm', 'inspiring'],
    tags: ['vibrant', 'sunset', 'warm'],
    difficulty: 'beginner',
  },
  ocean: {
    name: 'Ocean',
    description: 'Deep ocean blues for maritime themes',
    useCase: ['marine', 'water-sports', 'cruise', 'coastal'],
    mood: ['deep', 'powerful', 'calm'],
    tags: ['vibrant', 'blue', 'water'],
    difficulty: 'beginner',
  },
  forest: {
    name: 'Forest',
    description: 'Rich forest greens for natural depth',
    useCase: ['environment', 'hiking', 'nature', 'conservation'],
    mood: ['grounded', 'natural', 'alive'],
    tags: ['vibrant', 'green', 'nature'],
    difficulty: 'beginner',
  },
  purple: {
    name: 'Purple',
    description: 'Royal purple gradients for luxury',
    useCase: ['luxury', 'royalty', 'beauty', 'premium'],
    mood: ['luxurious', 'mysterious', 'rich'],
    tags: ['vibrant', 'purple', 'luxury'],
    difficulty: 'beginner',
  },
  fire: {
    name: 'Fire',
    description: 'Blazing fire reds and oranges',
    useCase: ['energy', 'sports', 'intensity', 'passion'],
    mood: ['intense', 'powerful', 'hot'],
    tags: ['vibrant', 'red', 'energy'],
    difficulty: 'beginner',
  },
  crimson: {
    name: 'Crimson',
    description: 'Deep crimson to bright pink progression',
    useCase: ['fashion', 'bold-brands', 'romance', 'luxury'],
    mood: ['bold', 'passionate', 'confident'],
    tags: ['vibrant', 'red', 'bold'],
    difficulty: 'beginner',
  },
  neon: {
    name: 'Neon',
    description: 'Electric neon colors for modern energy',
    useCase: ['nightlife', 'gaming', 'tech', 'youth'],
    mood: ['electric', 'modern', 'edgy'],
    tags: ['vibrant', 'neon', 'electric'],
    difficulty: 'intermediate',
  },
  tropical: {
    name: 'Tropical',
    description: 'Aqua and gold tropical paradise',
    useCase: ['vacation', 'resort', 'beach', 'paradise'],
    mood: ['exotic', 'relaxed', 'sunny'],
    tags: ['vibrant', 'tropical', 'beach'],
    difficulty: 'beginner',
  },

  // GLASSMORPHISM
  frostedGlass: {
    name: 'Frosted Glass',
    description: 'Soft translucent blue-whites for glass effects',
    useCase: ['ui-overlay', 'modern-apps', 'cards', 'modals'],
    mood: ['modern', 'clean', 'sophisticated'],
    tags: ['glassmorphism', 'ui', 'modern'],
    difficulty: 'intermediate',
    trending: true,
  },
  softNeumorphic: {
    name: 'Soft Neumorphic',
    description: 'Subtle gray tones for neumorphic design',
    useCase: ['ui-elements', 'buttons', 'soft-ui', 'minimal'],
    mood: ['subtle', 'tactile', 'soft'],
    tags: ['neumorphism', 'ui', 'minimal'],
    difficulty: 'intermediate',
    trending: true,
  },
  translucentLayers: {
    name: 'Translucent Layers',
    description: 'Light gray layers for depth',
    useCase: ['backgrounds', 'overlays', 'cards', 'layers'],
    mood: ['layered', 'depth', 'airy'],
    tags: ['glassmorphism', 'layers', 'ui'],
    difficulty: 'intermediate',
    trending: true,
  },
  blurredDepth: {
    name: 'Blurred Depth',
    description: 'Soft grays with blur effect inspiration',
    useCase: ['hero-sections', 'backgrounds', 'overlays'],
    mood: ['dreamy', 'soft', 'modern'],
    tags: ['glassmorphism', 'blur', 'depth'],
    difficulty: 'intermediate',
    trending: true,
  },
  glassMorph: {
    name: 'Glass Morph',
    description: 'Classic glassmorphism white to gray',
    useCase: ['dashboards', 'apps', 'cards', 'ui-kit'],
    mood: ['futuristic', 'clean', 'premium'],
    tags: ['glassmorphism', 'modern', 'ui'],
    difficulty: 'intermediate',
    trending: true,
  },

  // WEB3/CRYPTO
  bitcoinGold: {
    name: 'Bitcoin Gold',
    description: 'Dark to orange Bitcoin-inspired gradient',
    useCase: ['crypto', 'blockchain', 'fintech', 'investment'],
    mood: ['valuable', 'tech', 'bold'],
    tags: ['web3', 'crypto', 'bitcoin'],
    difficulty: 'intermediate',
    trending: true,
  },
  ethereumGrad: {
    name: 'Ethereum',
    description: 'Blue gradient inspired by Ethereum',
    useCase: ['crypto', 'smart-contracts', 'defi', 'blockchain'],
    mood: ['innovative', 'tech', 'futuristic'],
    tags: ['web3', 'crypto', 'ethereum'],
    difficulty: 'intermediate',
    trending: true,
  },
  defiBlue: {
    name: 'DeFi Blue',
    description: 'Deep blue for decentralized finance',
    useCase: ['defi', 'finance', 'crypto', 'trading'],
    mood: ['trustworthy', 'tech', 'professional'],
    tags: ['web3', 'defi', 'finance'],
    difficulty: 'intermediate',
    trending: true,
  },
  nftPrismatic: {
    name: 'NFT Prismatic',
    description: 'Rainbow spectrum for NFT platforms',
    useCase: ['nft', 'art', 'digital-collectibles', 'metaverse'],
    mood: ['creative', 'valuable', 'unique'],
    tags: ['web3', 'nft', 'art'],
    difficulty: 'advanced',
    trending: true,
  },
  blockchainNet: {
    name: 'Blockchain Network',
    description: 'Dark blue network-inspired gradient',
    useCase: ['blockchain', 'network', 'tech', 'infrastructure'],
    mood: ['technical', 'connected', 'secure'],
    tags: ['web3', 'blockchain', 'network'],
    difficulty: 'intermediate',
    trending: true,
  },

  // COLOR THEORY - TRIADIC
  primaryTriad: {
    name: 'Primary Triad',
    description: 'Red, yellow, blue - fundamental color triad',
    useCase: ['education', 'children', 'basics', 'learning'],
    mood: ['fundamental', 'bold', 'educational'],
    tags: ['color-theory', 'triadic', 'primary'],
    difficulty: 'beginner',
  },
  secondaryTriad: {
    name: 'Secondary Triad',
    description: 'Orange, purple, cyan secondary triad',
    useCase: ['design', 'art', 'creative', 'balance'],
    mood: ['balanced', 'creative', 'harmonious'],
    tags: ['color-theory', 'triadic', 'secondary'],
    difficulty: 'intermediate',
  },
  tertiaryTriad: {
    name: 'Tertiary Triad',
    description: 'Advanced tertiary color harmony',
    useCase: ['sophisticated-design', 'art', 'complex'],
    mood: ['sophisticated', 'complex', 'artistic'],
    tags: ['color-theory', 'triadic', 'tertiary'],
    difficulty: 'advanced',
  },
  warmTriad: {
    name: 'Warm Triad',
    description: 'Warm colors in triadic harmony',
    useCase: ['energy', 'warmth', 'inviting', 'food'],
    mood: ['warm', 'energetic', 'inviting'],
    tags: ['color-theory', 'triadic', 'warm'],
    difficulty: 'intermediate',
  },
  coolTriad: {
    name: 'Cool Triad',
    description: 'Cool colors in triadic harmony',
    useCase: ['calm', 'professional', 'tech', 'health'],
    mood: ['cool', 'calm', 'refreshing'],
    tags: ['color-theory', 'triadic', 'cool'],
    difficulty: 'intermediate',
  },
  earthTriad: {
    name: 'Earth Triad',
    description: 'Earth tone triadic harmony',
    useCase: ['nature', 'organic', 'rustic', 'authentic'],
    mood: ['grounded', 'natural', 'authentic'],
    tags: ['color-theory', 'triadic', 'earth'],
    difficulty: 'intermediate',
  },

  // DARK MODE
  darkVibrant: {
    name: 'Dark Vibrant',
    description: 'Vibrant neon colors for dark backgrounds',
    useCase: ['dark-mode', 'gaming', 'nightlife', 'modern-ui'],
    mood: ['energetic', 'modern', 'bold'],
    tags: ['dark-mode', 'vibrant', 'neon'],
    difficulty: 'intermediate',
    trending: true,
  },
  darkProfessional: {
    name: 'Dark Professional',
    description: 'Professional gray palette for dark interfaces',
    useCase: ['dark-mode-ui', 'professional-apps', 'dashboards'],
    mood: ['professional', 'sophisticated', 'modern'],
    tags: ['dark-mode', 'professional', 'ui'],
    difficulty: 'intermediate',
    trending: true,
  },
  darkPastel: {
    name: 'Dark Pastel',
    description: 'Pastels optimized for dark backgrounds',
    useCase: ['dark-mode', 'gentle-ui', 'accessible'],
    mood: ['gentle', 'accessible', 'modern'],
    tags: ['dark-mode', 'pastel', 'accessible'],
    difficulty: 'intermediate',
    trending: true,
  },
  oledSafe: {
    name: 'OLED Safe',
    description: 'High-contrast colors safe for OLED displays',
    useCase: ['mobile', 'oled-displays', 'battery-efficient'],
    mood: ['vibrant', 'efficient', 'modern'],
    tags: ['dark-mode', 'oled', 'mobile'],
    difficulty: 'advanced',
    trending: true,
  },

  // Y2K REVIVAL
  y2kChrome: {
    name: 'Y2K Chrome',
    description: 'Metallic chrome and neon Y2K aesthetic',
    useCase: ['retro', 'fashion', 'nostalgic', 'bold'],
    mood: ['nostalgic', 'futuristic', 'bold'],
    tags: ['y2k', 'retro', 'chrome'],
    difficulty: 'intermediate',
    trending: true,
  },
  bubblegumPop: {
    name: 'Bubblegum Pop',
    description: 'Hot pink Y2K pop culture vibes',
    useCase: ['fashion', 'pop-culture', 'youth', 'bold'],
    mood: ['playful', 'bold', 'fun'],
    tags: ['y2k', 'pink', 'pop'],
    difficulty: 'beginner',
    trending: true,
  },
  earlyInternet: {
    name: 'Early Internet',
    description: 'Primary colors of early internet era',
    useCase: ['retro', 'tech', 'nostalgic', 'web'],
    mood: ['nostalgic', 'simple', 'bold'],
    tags: ['y2k', 'internet', 'retro'],
    difficulty: 'beginner',
    trending: true,
  },
  flashEra: {
    name: 'Flash Era',
    description: 'Bold colors from Flash animation era',
    useCase: ['animation', 'retro', 'games', 'bold'],
    mood: ['energetic', 'nostalgic', 'playful'],
    tags: ['y2k', 'flash', 'retro'],
    difficulty: 'intermediate',
    trending: true,
  },

  // AI & DATA VIZ
  dataHeatmap: {
    name: 'Data Heatmap',
    description: 'Blue to red heatmap for data visualization',
    useCase: ['analytics', 'dashboards', 'data-viz', 'reports'],
    mood: ['analytical', 'informative', 'clear'],
    tags: ['ai', 'data', 'heatmap'],
    difficulty: 'intermediate',
  },
  mlConfidence: {
    name: 'ML Confidence',
    description: 'Green gradient for confidence scores',
    useCase: ['machine-learning', 'ai', 'predictions', 'scores'],
    mood: ['confident', 'technical', 'positive'],
    tags: ['ai', 'ml', 'data'],
    difficulty: 'intermediate',
  },
  analyticsDash: {
    name: 'Analytics Dashboard',
    description: 'Professional blue for analytics interfaces',
    useCase: ['dashboards', 'analytics', 'business-intelligence'],
    mood: ['professional', 'analytical', 'trustworthy'],
    tags: ['ai', 'analytics', 'dashboard'],
    difficulty: 'intermediate',
  },
  neuralNetwork: {
    name: 'Neural Network',
    description: 'Teal gradient for AI/ML applications',
    useCase: ['ai', 'neural-networks', 'deep-learning', 'tech'],
    mood: ['technical', 'innovative', 'intelligent'],
    tags: ['ai', 'neural', 'tech'],
    difficulty: 'advanced',
  },
  predictionCurve: {
    name: 'Prediction Curve',
    description: 'Purple gradient for prediction models',
    useCase: ['predictions', 'forecasting', 'ai', 'data-science'],
    mood: ['predictive', 'mystical', 'technical'],
    tags: ['ai', 'prediction', 'data'],
    difficulty: 'advanced',
  },
  dataFlow: {
    name: 'Data Flow',
    description: 'Blue gradient for data pipelines',
    useCase: ['data-flow', 'pipelines', 'processing', 'tech'],
    mood: ['flowing', 'technical', 'dynamic'],
    tags: ['ai', 'data', 'flow'],
    difficulty: 'intermediate',
  },

  // WELLNESS
  meditationCalm: {
    name: 'Meditation Calm',
    description: 'Soft greens for meditation and mindfulness',
    useCase: ['meditation', 'wellness', 'apps', 'relaxation'],
    mood: ['peaceful', 'calm', 'zen'],
    tags: ['wellness', 'meditation', 'calm'],
    difficulty: 'beginner',
  },
  therapyGreen: {
    name: 'Therapy Green',
    description: 'Gentle greens for therapeutic environments',
    useCase: ['therapy', 'healthcare', 'wellness', 'healing'],
    mood: ['healing', 'safe', 'nurturing'],
    tags: ['wellness', 'therapy', 'green'],
    difficulty: 'beginner',
  },
  spaTranquil: {
    name: 'Spa Tranquil',
    description: 'Aqua tones for spa and relaxation',
    useCase: ['spa', 'wellness', 'relaxation', 'beauty'],
    mood: ['tranquil', 'luxurious', 'refreshing'],
    tags: ['wellness', 'spa', 'blue'],
    difficulty: 'beginner',
  },
  yogaBalance: {
    name: 'Yoga Balance',
    description: 'Purple gradient for yoga and balance',
    useCase: ['yoga', 'fitness', 'balance', 'mindfulness'],
    mood: ['balanced', 'spiritual', 'centered'],
    tags: ['wellness', 'yoga', 'balance'],
    difficulty: 'beginner',
  },
  mindfulnessBlue: {
    name: 'Mindfulness Blue',
    description: 'Calming blues for mindfulness practices',
    useCase: ['mindfulness', 'meditation', 'mental-health'],
    mood: ['mindful', 'calm', 'focused'],
    tags: ['wellness', 'mindfulness', 'blue'],
    difficulty: 'beginner',
  },
  zenGarden: {
    name: 'Zen Garden',
    description: 'Earthy browns for zen aesthetics',
    useCase: ['zen', 'minimalist', 'nature', 'peace'],
    mood: ['zen', 'grounded', 'simple'],
    tags: ['wellness', 'zen', 'earth'],
    difficulty: 'beginner',
  },

  // PSYCHEDELIC ACID
  electricDreams: {
    name: 'Electric Dreams',
    description: 'Vivid magenta-cyan-pink-green mesh gradient',
    useCase: ['music', 'nightlife', 'festivals', 'psychedelic-art'],
    mood: ['trippy', 'vibrant', 'energetic'],
    tags: ['psychedelic', 'acid', 'neon', 'hdr'],
    difficulty: 'intermediate',
    trending: true,
  },
  acidRain: {
    name: 'Acid Rain',
    description: 'Deep purple to cyan high-contrast fade',
    useCase: ['album-covers', 'posters', 'digital-art', 'vaporwave'],
    mood: ['intense', 'dreamy', 'psychedelic'],
    tags: ['psychedelic', 'acid', '2-color', 'hdr'],
    difficulty: 'beginner',
    trending: true,
  },
  neonMelt: {
    name: 'Neon Melt',
    description: 'Hot pink-gold-mint-purple HDR blend',
    useCase: ['edm', 'rave', 'club-visuals', 'vj-loops'],
    mood: ['explosive', 'vibrant', 'wild'],
    tags: ['psychedelic', 'acid', 'neon', 'hdr'],
    difficulty: 'advanced',
    trending: true,
  },
  cyberFlux: {
    name: 'Cyber Flux',
    description: 'Pink to electric blue high-saturation gradient',
    useCase: ['synthwave', 'retro-futurism', 'cyberpunk', 'gaming'],
    mood: ['energetic', 'futuristic', 'bold'],
    tags: ['psychedelic', 'acid', '2-color', 'cyber'],
    difficulty: 'beginner',
    trending: true,
  },
  trippySunset: {
    name: 'Trippy Sunset',
    description: 'Pink-yellow-cyan-purple spectrum explosion',
    useCase: ['festivals', 'psychedelic-art', 'music-visuals', 'trippy'],
    mood: ['psychedelic', 'vibrant', 'surreal'],
    tags: ['psychedelic', 'acid', 'spectrum', 'hdr'],
    difficulty: 'intermediate',
    trending: true,
  },
  laserBeam: {
    name: 'Laser Beam',
    description: 'Neon green to hot magenta laser-sharp contrast',
    useCase: ['edm', 'laser-shows', 'club-lights', 'neon-signs'],
    mood: ['intense', 'electric', 'sharp'],
    tags: ['psychedelic', 'acid', '2-color', 'laser'],
    difficulty: 'beginner',
    trending: true,
  },
  holographicShift: {
    name: 'Holographic Shift',
    description: 'Full-spectrum holographic iridescence',
    useCase: ['fashion', 'holographic-effects', 'futuristic', 'prismatic'],
    mood: ['holographic', 'futuristic', 'vibrant'],
    tags: ['psychedelic', 'acid', 'holographic', 'hdr'],
    difficulty: 'advanced',
    trending: true,
  },
  raveLights: {
    name: 'Rave Lights',
    description: 'Red-cyan-lime-magenta rave light spectrum',
    useCase: ['raves', 'edm-festivals', 'club-visuals', 'nightlife'],
    mood: ['energetic', 'wild', 'electric'],
    tags: ['psychedelic', 'acid', 'rave', 'neon'],
    difficulty: 'intermediate',
    trending: true,
  },
};

/**
 * Get metadata for a specific palette
 */
export function getPaletteMetadata(paletteName: string): PaletteMetadata | null {
  return PALETTE_METADATA[paletteName] || null;
}

/**
 * Search palettes by tag
 */
export function searchPalettesByTag(tag: string): string[] {
  return Object.entries(PALETTE_METADATA)
    .filter(([_, meta]) => meta.tags.includes(tag.toLowerCase()))
    .map(([name, _]) => name);
}

/**
 * Get trending palettes
 */
export function getTrendingPalettes(): string[] {
  return Object.entries(PALETTE_METADATA)
    .filter(([_, meta]) => meta.trending === true)
    .map(([name, _]) => name);
}

/**
 * Search palettes by use case
 */
export function searchPalettesByUseCase(useCase: string): string[] {
  return Object.entries(PALETTE_METADATA)
    .filter(([_, meta]) => meta.useCase.some(uc => uc.includes(useCase.toLowerCase())))
    .map(([name, _]) => name);
}

/**
 * Search palettes by mood
 */
export function searchPalettesByMood(mood: string): string[] {
  return Object.entries(PALETTE_METADATA)
    .filter(([_, meta]) => meta.mood.some(m => m.includes(mood.toLowerCase())))
    .map(([name, _]) => name);
}

/**
 * Get palettes by difficulty level
 */
export function getPalettesByDifficulty(difficulty: 'beginner' | 'intermediate' | 'advanced'): string[] {
  return Object.entries(PALETTE_METADATA)
    .filter(([_, meta]) => meta.difficulty === difficulty)
    .map(([name, _]) => name);
}
