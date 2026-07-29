# 🤝 Contributing to Blendcraft Studio

Thank you for your interest in contributing to Blendcraft Studio! This document provides guidelines and instructions for contributing.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Project Structure](#project-structure)

---

## 🤗 Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inspiring community for all. Please be respectful and considerate in all interactions.

### Expected Behavior

- Use welcoming and inclusive language
- Be respectful of differing viewpoints
- Accept constructive criticism gracefully
- Focus on what's best for the community
- Show empathy towards other community members

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18.x or higher
- **npm** or **pnpm** (recommended)
- **Git**
- Modern browser with WebGL 2.0 support

### Setup

```bash
# 1. Fork the repository on GitHub
# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/blendcraft-studio.git
cd blendcraft-studio

# 3. Add upstream remote
git remote add upstream https://github.com/ORIGINAL_OWNER/blendcraft-studio.git

# 4. Install dependencies
npm install
# or
pnpm install

# 5. Create a feature branch
git checkout -b feature/your-feature-name

# 6. Start development server
npm run dev
```

---

## 💻 Development Workflow

### 1. Choose an Issue

- Browse [open issues](https://github.com/yourusername/blendcraft-studio/issues)
- Look for issues labeled `good first issue` or `help wanted`
- Comment on the issue to let others know you're working on it

### 2. Create a Branch

```bash
# Feature branch
git checkout -b feature/gradient-reverse-button

# Bug fix branch
git checkout -b fix/export-png-transparency

# Documentation branch
git checkout -b docs/update-readme
```

### 3. Make Changes

- Write clean, readable code
- Follow existing code style
- Add comments for complex logic
- Update documentation if needed

### 4. Test Locally

```bash
# Test your changes
npm run dev

# Build for production
npm run build

# Test production build
npm run preview
```

### 5. Commit Your Changes

```bash
git add .
git commit -m "feat: add gradient reverse button"
```

### 6. Push and Create PR

```bash
git push origin feature/gradient-reverse-button
```

Then create a Pull Request on GitHub.

---

## 📐 Coding Standards

### TypeScript

- Use TypeScript for all new files
- Define proper types/interfaces
- Avoid `any` type when possible
- Use strict mode

```typescript
// Good
interface GradientConfig {
  type: GradientType;
  colors: ColorStop[];
  angle?: number;
}

// Avoid
const config: any = { ... };
```

### React Components

- Use functional components with hooks
- Extract reusable logic into custom hooks
- Implement proper cleanup in useEffect

```typescript
// Good
export function MyComponent() {
  useEffect(() => {
    const cleanup = () => { /* cleanup logic */ };
    return cleanup;
  }, []);
}
```

### File Naming

- **Components:** PascalCase - `GradientCanvas.tsx`
- **Hooks:** camelCase with `use` prefix - `useGradientState.ts`
- **Utils:** camelCase - `gradientRenderer.ts`
- **Types:** PascalCase - `gradient.ts`

### Code Style

- Use 2 spaces for indentation
- Use single quotes for strings
- Add semicolons
- Max line length: 100 characters
- Use meaningful variable names

```typescript
// Good
const activeLayer = layers.find(l => l.id === activeLayerId);

// Avoid
const al = layers.find(x => x.id === id);
```

### Performance

- Use `useMemo` for expensive calculations
- Use `useCallback` for function props
- Avoid unnecessary re-renders
- Clean up resources (event listeners, timers, WebGL)

```typescript
// Good
const expensiveValue = useMemo(() => {
  return computeComplexValue(data);
}, [data]);

const handleClick = useCallback(() => {
  // handler logic
}, [dependencies]);
```

---

## 🧪 Testing Guidelines

### Manual Testing

Before submitting a PR, test:

1. **Functionality:** Does the feature work as expected?
2. **Performance:** Does it maintain 60 FPS?
3. **Browser Compatibility:** Test in Chrome, Firefox, Safari
4. **Edge Cases:** Test with extreme values (10+ layers, etc.)

### Testing Checklist

- [ ] Feature works in Chrome
- [ ] Feature works in Firefox
- [ ] Feature works in Safari
- [ ] No console errors
- [ ] No memory leaks (test with DevTools)
- [ ] Performance is acceptable (30+ FPS)
- [ ] UI is responsive
- [ ] No breaking changes

---

## 📝 Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/).

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding tests
- `chore`: Maintenance tasks

### Examples

```bash
# Feature
git commit -m "feat(gradient): add starburst gradient type"

# Bug fix
git commit -m "fix(export): resolve PNG transparency issue"

# Documentation
git commit -m "docs(readme): update installation instructions"

# Performance
git commit -m "perf(shader): optimize gradient rendering"
```

### Scope

Common scopes:
- `gradient` - Gradient engine
- `export` - Export functionality
- `ui` - User interface
- `animation` - Animation system
- `shader` - WebGL shaders
- `performance` - Performance optimizations

---

## 🔀 Pull Request Process

### Before Submitting

1. **Sync with upstream**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Test thoroughly** (see Testing Guidelines)

3. **Update documentation** if needed

4. **Check for conflicts** with main branch

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Tested in Chrome
- [ ] Tested in Firefox
- [ ] Tested in Safari
- [ ] No console errors
- [ ] Performance tested

## Screenshots (if applicable)
[Add screenshots here]

## Related Issues
Closes #123
```

### Review Process

1. Maintainer reviews code
2. Automated checks run (if configured)
3. Requested changes addressed
4. PR approved and merged

### After Merge

1. Delete your feature branch
2. Pull latest changes
   ```bash
   git checkout main
   git pull upstream main
   ```

---

## 📁 Project Structure

```
blendcraft-studio/
├── src/
│   ├── app/
│   │   ├── components/
│   │   │   ├── controls/      # Control panels
│   │   │   ├── gradient/      # Gradient canvas
│   │   │   ├── layout/        # Layout components
│   │   │   └── ui/            # UI primitives
│   │   ├── hooks/             # Custom React hooks
│   │   ├── shaders/           # WebGL shaders
│   │   ├── types/             # TypeScript types
│   │   └── utils/             # Utility functions
│   ├── styles/                # Global styles
│   └── imports/               # Assets
├── public/                    # Static assets
└── docs/                      # Documentation
```

### Key Files

- `App.tsx` - Main application component
- `GradientCanvas.tsx` - WebGL rendering engine
- `gradient.ts` - Type definitions
- `gradientRenderer.ts` - Gradient rendering logic
- `gradientShaders.ts` - GLSL shader code

---

## 🎨 Adding New Features

### Example: Adding a New Gradient Type

1. **Update types** (`src/app/types/gradient.ts`)
   ```typescript
   export type GradientType = 'linear' | 'radial' | 'mynewtype';
   ```

2. **Add shader** (`src/app/shaders/gradientShaders.ts`)
   ```glsl
   if (gradientType == MYNEWTYPE) {
     // GLSL implementation
   }
   ```

3. **Update renderer** (`src/app/utils/gradientRenderer.ts`)
   ```typescript
   case 'mynewtype':
     // Setup uniforms
     break;
   ```

4. **Add UI control** (`src/app/components/controls/GradientControls.tsx`)
   ```typescript
   <option value="mynewtype">My New Type</option>
   ```

5. **Test thoroughly**

6. **Update documentation**

---

## 🐛 Reporting Bugs

### Before Reporting

1. Check [existing issues](https://github.com/yourusername/blendcraft-studio/issues)
2. Test in latest version
3. Try in different browser

### Bug Report Template

```markdown
## Description
Clear description of the bug

## Steps to Reproduce
1. Go to...
2. Click on...
3. See error

## Expected Behavior
What should happen

## Actual Behavior
What actually happens

## Environment
- OS: [e.g., macOS 13.0]
- Browser: [e.g., Chrome 120]
- Version: [e.g., 0.0.1]

## Screenshots
[If applicable]
```

---

## 💡 Feature Requests

We love new ideas! Submit feature requests as GitHub issues with:

- **Use Case:** Why is this needed?
- **Description:** What should it do?
- **Examples:** Mockups, references, etc.
- **Impact:** Who benefits from this?

---

## 📞 Getting Help

- **Documentation:** Check [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)
- **Discussions:** Use [GitHub Discussions](https://github.com/yourusername/blendcraft-studio/discussions)
- **Issues:** For bugs and feature requests only

---

## 🏆 Recognition

Contributors will be:
- Listed in [CONTRIBUTORS.md](CONTRIBUTORS.md)
- Credited in release notes
- Mentioned in project documentation

---

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for making Blendcraft Studio better! 🎨✨**
