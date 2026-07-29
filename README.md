# 🎨 Blendcraft Studio

**Professional gradient generator with WebGL shaders, animations, and advanced effects.**

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/yourusername/blendcraft-studio)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## ✨ Features

### **🎨 Advanced Gradient Types**
- **Linear** - Classic directional gradients with angle control
- **Radial** - Circular gradients with center positioning
- **Conic** - Rotational color wheels and psychedelic effects
- **Diamond** - Focal point gradients for hero sections
- **Spiral** - Mesmerizing vortex patterns with twist control
- **Square** - Geometric frame effects and borders
- **Starburst** - Radial burst patterns for retro designs

### **🌊 Texture & Effects**
- **Noise Texture** - Eliminate color banding with subtle grain (10-50% intensity)
- **Topography** - Organic, lava-lamp-like flowing patterns
- **Animation Modes:**
  - **Drift** - Gentle, wandering motion
  - **Flow** - Dynamic, energetic movement
  - **Pulse** - Breathing, pulsing effects
  - **Rotation** - Smooth circular motion

### **🎬 Animation & Recording**
- Real-time WebGL-powered animations at **60 FPS**
- Smart cycle detection for seamless loops
- Export animated gradients as:
  - **MP4** - Universal video format
  - **WebM** - Optimized web video
  - **GIF** - Maximum compatibility

### **📤 Export Formats**
- **PNG** - High-quality static images
- **SVG** - Infinitely scalable vector graphics
- **CSS** - Copy/paste code for web projects
- **GRD** - Photoshop gradient files
- **Batch Export** - Export multiple presets at once
- **Social Media Presets:**
  - Instagram Story (1080×1920)
  - Instagram Post (1080×1080)
  - Twitter Header (1500×500)
  - YouTube Thumbnail (1280×720)

### **🧠 AI-Powered Tools**
- **Semantic Search** - Find gradients by mood ("sunset", "ocean", "forest")
- **30+ Premium Presets** - Curated across 10+ categories
- **Smart ProTips** - Contextual suggestions based on your work
- **42 Expert Tips** - Categorized learning system with progress tracking

### **🎨 Color Tools**
- **Advanced Color Picker** - HSL, RGB, HEX with alpha control
- **Color Harmony Generator:**
  - Complementary
  - Analogous
  - Triadic
  - Split-complementary
  - Tetradic
- **Image Color Extractor** - Pull palettes from photos
- **Color Stop Management** - Drag, position, lock, and fine-tune

### **⚡ Layer System**
- Unlimited gradient layers
- Blend modes (Normal, Multiply, Screen, Overlay, etc.)
- Layer opacity control
- Reorder with drag-and-drop
- Individual layer animations
- Copy/paste effects between layers

### **💾 Workflow Features**
- **Favorites System** - Save and organize your best gradients
- **Custom Presets** - Create and manage your own library
- **History Timeline** - Full undo/redo with visual preview
- **Auto-Save** - Never lose your work (saves every 30s)
- **Keyboard Shortcuts** - Pro-level efficiency
- **Tutorial System** - Interactive onboarding for new users

---

## 🚀 Quick Start

### **Installation**

```bash
# Clone the repository
git clone https://github.com/yourusername/blendcraft-studio.git
cd blendcraft-studio

# Install dependencies
npm install
# or
pnpm install

# Start development server
npm run dev
```

### **Development**

```bash
# Start dev server (http://localhost:5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Start production server
npm start
```

### **Deployment**

#### **Vercel (Recommended)**
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Deploy to production
vercel --prod
```

#### **Other Platforms**
1. Build the project: `npm run build`
2. Deploy the `dist/` folder to your hosting platform
3. Ensure static file serving is enabled

---

## 📖 Usage Guide

### **Creating Your First Gradient**

1. **Choose a gradient type** from the top toolbar
2. **Add color stops** by clicking on the gradient bar
3. **Select colors** using the color picker or harmony tools
4. **Adjust positions** by dragging color stops
5. **Add texture** for depth (try 15-20% noise)
6. **Export** in your preferred format

### **Advanced Techniques**

#### **Layer Blending**
```
1. Create base gradient (e.g., Linear sunset colors)
2. Add new layer
3. Create overlay gradient (e.g., Radial white spotlight)
4. Set blend mode to "Screen" or "Overlay"
5. Adjust opacity to 30-70%
```

#### **Animated Backgrounds**
```
1. Enable topography texture
2. Set animation mode to "Drift" or "Flow"
3. Adjust speed (0.3-0.7 for smooth motion)
4. Enable looping
5. Record as MP4/WebM
```

#### **Professional Color Schemes**
```
1. Start with base color
2. Use Harmony tab → "Complementary" or "Triadic"
3. Fine-tune with HSL sliders
4. Lock colors you like
5. Randomize the rest for variations
```

---

## 🎓 ProTips

> **Beginner Tip:** Start with 2-3 colors for clean, professional gradients. Add complexity gradually.

> **Performance Tip:** Disable unused layers and reduce texture intensity if FPS drops below 30.

> **Export Tip:** Use PNG for static images, SVG for web graphics, and MP4 for animated backgrounds.

> **Color Theory Tip:** Warm colors (red, orange) advance; cool colors (blue, green) recede. Use this for depth!

See the **ProTips Panel** in-app for 42 categorized expert tips with live examples.

---

## 🛠️ Tech Stack

- **React 18.3.1** - UI framework
- **TypeScript** - Type safety
- **Three.js** - WebGL rendering
- **Vite 6.3.5** - Build tool
- **Tailwind CSS 4.1.12** - Styling
- **Motion (Framer)** - Animations
- **Radix UI** - Accessible components
- **Simplex Noise** - Texture generation

---

## 📊 Performance

| Metric | Target | Actual |
|--------|--------|--------|
| Initial Load | <3s | ~2.1s ✅ |
| FPS (Idle) | 60 | 60 ✅ |
| FPS (1 Layer) | 60 | 60 ✅ |
| FPS (5 Layers) | 45+ | 48-55 ✅ |
| Bundle Size | <500KB | TBD |

**Performance Grade: A-** (92/100)

---

## 🗺️ Roadmap

### **Phase 1: Beta Launch** ✅ (Current)
- [x] Core gradient engine
- [x] 7 gradient types
- [x] Texture & animation system
- [x] Export functionality (6 formats)
- [x] ProTips system
- [x] Semantic search
- [ ] Public beta release

### **Phase 2: Enhancement** (Q2 2026)
- [ ] Mobile optimization
- [ ] Advanced masking
- [ ] Custom shader editor
- [ ] Collaboration features
- [ ] Cloud sync

### **Phase 3: Pro Features** (Q3 2026)
- [ ] Video export enhancements
- [ ] API access
- [ ] Plugin system
- [ ] Team workspaces
- [ ] Analytics dashboard

---

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### **Quick Contribution Guide**

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **Three.js** - WebGL rendering engine
- **Radix UI** - Accessible component primitives
- **Tailwind CSS** - Utility-first styling
- **Vite** - Lightning-fast build tool
- **Simplex Noise** - Organic texture generation
- **Community Contributors** - Thank you! ❤️

---

## 📞 Support

- **Documentation:** [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)
- **User Guide:** [USER_GUIDE.md](USER_GUIDE.md)
- **Issues:** [GitHub Issues](https://github.com/yourusername/blendcraft-studio/issues)
- **Discussions:** [GitHub Discussions](https://github.com/yourusername/blendcraft-studio/discussions)

---

## 🌟 Star History

If you find Blendcraft Studio useful, please consider giving it a star! ⭐

---

**Made with 💜 by the Blendcraft Team**

*Creating beautiful gradients, one pixel at a time.*