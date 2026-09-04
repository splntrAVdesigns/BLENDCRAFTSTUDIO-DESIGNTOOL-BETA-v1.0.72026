# Public Assets for Blendcraft Studio PWA

This directory contains Progressive Web App (PWA) assets.

## Files

### Service Worker (`sw.js`)
- Handles offline caching
- Manages app updates
- Network strategies for different asset types
- Automatic cache cleanup

**Note**: To test service worker locally:
1. Run `npm run build` to build production version
2. Serve the build: `npx serve dist`
3. Open in browser (must be http://localhost or https://)
4. Check DevTools > Application > Service Workers

### PWA Manifest (`manifest.json`)
- App metadata for installation
- Icon definitions
- Display settings (standalone)
- Theme colors
- Share target configuration

**Note**: To test installation:
1. Open app in Chrome/Edge
2. Click install icon in address bar
3. App installs as standalone application

## Required Icon Files (To Add)

For full PWA support, add these icon files to `/public`:

```
/public/
  ├── icon-192.png   (192x192px app icon)
  ├── icon-512.png   (512x512px app icon)
  ├── screenshot-desktop.png  (1920x1080px, optional)
  └── screenshot-mobile.png   (750x1334px, optional)
```

### Icon Requirements:
- **192x192**: Minimum required size, used for app launcher
- **512x512**: High-res icon for splash screens
- **Format**: PNG with transparency
- **Content**: Should be the Blendcraft Studio logo
- **Safe Area**: Keep important content in center 80%

### Screenshot Requirements (Optional):
- **Desktop**: 1920x1080px, shows app in use
- **Mobile**: 750x1334px, shows mobile view
- **Purpose**: Displayed in install prompts and app stores

## Quick Icon Generation

If you don't have icons yet, you can:

1. **Use a placeholder generator**:
   - Visit https://realfavicongenerator.net/
   - Upload a logo or create one
   - Download PWA icon pack

2. **Create from logo**:
   ```bash
   # If you have ImageMagick installed
   convert logo.png -resize 192x192 icon-192.png
   convert logo.png -resize 512x512 icon-512.png
   ```

3. **Use Figma export**:
   - Export logo at 192x192 and 512x512
   - Ensure transparent background
   - Save as PNG

## Testing PWA Features

### Chrome DevTools:
1. Open DevTools (F12)
2. Go to Application tab
3. Check:
   - Manifest: Should show app details
   - Service Workers: Should be "activated and running"
   - Cache Storage: Should show cached files

### Lighthouse:
1. Open DevTools
2. Go to Lighthouse tab
3. Run PWA audit
4. Target score: 100/100

### Offline Mode:
1. Open app
2. DevTools > Network tab
3. Select "Offline" throttling
4. Refresh page
5. App should still work!

## Browser Support

- ✅ Chrome 90+ (full support)
- ✅ Edge 90+ (full support)
- ✅ Firefox 88+ (full support)
- ⚠️ Safari 14+ (limited install UI)
- ⚠️ Mobile Safari 13+ (add to home screen)

## Troubleshooting

### Service Worker Not Registering:
- Must be served over HTTPS or localhost
- Check browser console for errors
- Clear cache and hard refresh (Ctrl+Shift+R)
- Check sw.js syntax

### Manifest Errors:
- Validate JSON syntax
- Ensure icon files exist
- Check icon paths are relative to public/
- Verify MIME type (application/manifest+json)

### Cache Issues:
- Clear all caches in DevTools > Application > Clear Storage
- Unregister service worker
- Hard refresh browser
- Check cache version in sw.js

### Update Not Showing:
- Service worker caches aggressively
- May need to close all tabs and reopen
- Can manually trigger: navigator.serviceWorker.update()
- Check update notification component

## Deployment Notes

### For Production:
1. Ensure all icon files are present
2. Update manifest.json with production URL
3. Set proper cache versions in sw.js
4. Test offline functionality
5. Verify update flow works

### CDN Considerations:
- Service worker must be served from same origin
- Don't CDN the sw.js file
- Manifest can be CDN'd but not recommended
- Icons can be CDN'd

### HTTPS Required:
- Service workers require HTTPS in production
- Localhost exception for development
- Use Let's Encrypt for free SSL

## Additional Resources

- [MDN: PWA Guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- [web.dev: PWA](https://web.dev/progressive-web-apps/)
- [PWA Builder](https://www.pwabuilder.com/)
- [Workbox (Google SW library)](https://developers.google.com/web/tools/workbox)

---

**For help**: See `/PHASE8_OPTIMIZATION_COMPLETE.md` or `/OPTIMIZATION_QUICK_REFERENCE.md`
