# 🧪 Animation System Testing Guide

## Quick Start Testing

### **Test 1: Wave Animation (Linear Gradient)**
1. Create a new layer with **Linear gradient**
2. Add 3-4 color stops (e.g., purple → pink → orange)
3. Enable animation → Select **Wave**
4. Set Speed: **5**, Intensity: **0.8**
5. Play animation
6. ✅ **Expected:** Endless scrolling wave perpendicular to gradient angle, no resets

**Test variations:**
- Change Direction to **Reverse** → Wave flows backward
- Change Direction to **Ping-Pong** → Wave oscillates back and forth
- Change Easing to **Ease In-Out** → Smooth acceleration/deceleration
- Rotate gradient angle → Wave direction changes

---

### **Test 2: Vortex Animation (Radial Gradient)**
1. Create a new layer with **Radial gradient**
2. Add 3-4 color stops
3. Enable animation → Select **Vortex**
4. Set Speed: **3**, Intensity: **1.0**
5. Play animation
6. ✅ **Expected:** Continuous swirling from center, smooth rotation, no jumps

**Test variations:**
- Adjust center position → Vortex swirls from new center
- Change Speed to **10** → Fast swirl
- Change Intensity to **0.5** → Subtle swirl

---

### **Test 3: Morph Animation (Any Gradient)**
1. Create layer with **Linear, Radial, or Noise gradient**
2. Enable animation → Select **Morph**
3. Set Speed: **2**, Intensity: **0.7**
4. Play animation
5. ✅ **Expected:** Organic, flowing distortion, seamless loop

**Test variations:**
- Try with **Linear** → Horizontal/vertical morphing
- Try with **Radial** → Radial morphing from center
- Try with **Noise** → Enhanced organic chaos

---

### **Test 4: Kaleidoscope (Conic Gradient)**
1. Create layer with **Conic gradient**
2. Add vibrant color stops
3. Enable animation → Select **Kaleidoscope**
4. Set Speed: **4**, Intensity: **0.9**
5. Play animation
6. ✅ **Expected:** Mirror-symmetric segments rotating, no visible seams

**Test variations:**
- Change gradient center → Kaleidoscope rotates from new point
- Adjust angle → Starting rotation changes

---

### **Test 5: Fractal Zoom (Fractal Gradient)**
1. Create layer with **Fractal gradient**
2. Set Octaves: **6**, Frequency: **2**
3. Enable animation → Select **Fractal Zoom**
4. Set Speed: **2**, Intensity: **0.8**
5. Play animation
6. ✅ **Expected:** Smooth recursive zoom with ripples, endless cycle

**Test variations:**
- Try with **Linear** → Linear fractal zoom
- Try with **Radial** → Radial fractal zoom
- Adjust Scale slider → Zoom range changes

---

### **Test 6: Turbulence (Turbulence Gradient)**
1. Create layer with **Turbulence gradient**
2. Set Octaves: **6**, Frequency: **2**
3. Enable animation → Select **Turbulence**
4. Set Speed: **3**, Intensity: **1.0**
5. Play animation
6. ✅ **Expected:** Chaotic multi-frequency distortion, continuous flow

**Test variations:**
- Try with **Linear** → Linear turbulence
- Try with **Noise** → Noise-enhanced turbulence
- Adjust Frequency → Changes turbulence scale

---

## Advanced Testing

### **Direction Testing**
For each animation, test:
1. **Forward** → Normal direction
2. **Reverse** → Opposite direction (should look natural, not just backwards)
3. **Ping-Pong** → Back and forth oscillation (seamless turnaround)

### **Easing Testing**
For each animation, test:
1. **Linear** → Constant speed
2. **Ease In** → Slow start, fast end
3. **Ease Out** → Fast start, slow end
4. **Ease In-Out** → Smooth acceleration and deceleration
5. **Bounce** → Bouncy oscillation
6. **Elastic** → Elastic spring effect

### **Speed Testing**
- **0.1-1.0** → Very slow, meditative
- **1.0-5.0** → Normal speed range
- **5.0-10.0** → Fast, energetic

### **Intensity Testing**
- **0.0-0.3** → Subtle, background effect
- **0.3-0.7** → Moderate, noticeable
- **0.7-1.0** → Strong, dramatic

### **Loop Testing**
1. Enable Loop → Animation continues forever
2. Disable Loop → Animation plays once and freezes
3. Click "Restart Cycle" → Animation jumps back to start

---

## Export Testing

### **Video Export Test**
1. Create animated gradient (Wave, Vortex, or Morph)
2. Set Speed: **3**, Duration: **5 seconds**
3. Click Export → Video (MP4/WebM)
4. ✅ **Expected:** Smooth animation, no visible frame jumps
5. ✅ **Expected:** Animation starts at t=0, not mid-cycle

### **GIF Export Test**
1. Create animated gradient with high contrast colors
2. Set Duration: **3 seconds**, FPS: **30**
3. Export as GIF
4. ✅ **Expected:** Seamless loop when played repeatedly

---

## Regression Testing

### **Old Animations (Should Still Work)**
Test these to ensure nothing broke:
- ✅ Rotation → Continuous spin
- ✅ Pulse → Breathing scale
- ✅ Scale → Zoom oscillation
- ✅ Drift → Multi-axis meandering
- ✅ Ripple → Concentric rings
- ✅ Shimmer → Specular sweep
- ✅ Hue Shift → Color cycle
- ✅ Chromatic Pulse → RGB breathing
- ✅ Glitch → Quantized corruption
- ✅ Liquid → Fluid flow

---

## Edge Cases

### **Multiple Layers**
1. Create 3 layers
2. Layer 1: Linear + Wave
3. Layer 2: Radial + Vortex  
4. Layer 3: Conic + Kaleidoscope
5. Play all simultaneously
6. ✅ **Expected:** All animate independently, no conflicts

### **Interaction + Animation**
1. Enable animation (e.g., Wave)
2. Switch to Interactive Mode (X/Y pad)
3. Drag to adjust gradient
4. ✅ **Expected:** Animation continues, interaction works

### **Restart During Play**
1. Start animation
2. Wait 3 seconds
3. Click "Restart Cycle"
4. ✅ **Expected:** Animation jumps back to t=0, continues smoothly

### **Change Animation Type Mid-Play**
1. Start with Wave animation
2. While playing, switch to Morph
3. ✅ **Expected:** Smooth transition, no jarring jump

---

## Performance Testing

### **High Complexity**
1. Create layer with Fractal gradient (Octaves: 8)
2. Enable Fractal Zoom animation
3. Add texture overlay (Plasma, intensity 0.5)
4. Play animation
5. ✅ **Expected:** Maintains 60fps (check browser DevTools)

### **Multiple Animated Layers**
1. Create 5 layers, all with different animations
2. Play all simultaneously
3. ✅ **Expected:** Smooth playback, no frame drops

---

## Visual Verification Checklist

For each shader-driven animation:
- [ ] **No visible resets** at loop boundary
- [ ] **Smooth continuous motion** throughout
- [ ] **Direction reversal works** naturally
- [ ] **Easing affects motion** visibly
- [ ] **Intensity scales effect** appropriately
- [ ] **Speed changes tempo** correctly
- [ ] **Export matches preview** exactly
- [ ] **Restart button works** immediately

---

## Known Issues (Should Be Fixed)

These were the original problems, now resolved:
- ~~Wave resets to position 0 every cycle~~ ✅ FIXED
- ~~Morph snaps back to original position~~ ✅ FIXED
- ~~Vortex jumps when loop completes~~ ✅ FIXED
- ~~Kaleidoscope stutters at loop boundary~~ ✅ FIXED
- ~~Fractal Zoom hard resets to initial scale~~ ✅ FIXED
- ~~Turbulence has chaotic jump at cycle end~~ ✅ FIXED

---

## Bug Reporting Template

If you find issues, report with:

**Animation Type:** [Wave/Morph/Vortex/etc.]  
**Gradient Type:** [Linear/Radial/Conic/etc.]  
**Settings:**
- Speed: [value]
- Intensity: [value]
- Direction: [Forward/Reverse/Ping-Pong]
- Easing: [Linear/Ease In/etc.]

**Issue:** [Describe what's wrong]  
**Expected:** [What should happen]  
**Actual:** [What actually happens]  
**Screenshot/Video:** [If possible]

---

## Success Criteria

### ✅ All Tests Pass If:
1. No visible resets or jumps at loop boundaries
2. All direction modes work smoothly
3. All easing types affect motion correctly
4. Export matches live preview
5. Performance is 60fps with reasonable complexity
6. Multiple layers animate independently
7. UI controls respond immediately

---

**Happy Testing!** 🎨✨
