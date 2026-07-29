import { readFileSync } from 'fs';

// Helper to convert circle to path
function circleToPath(cx, cy, r) {
  return `M${cx-r},${cy}a${r},${r} 0 1,0 ${r*2},0a${r},${r} 0 1,0 -${r*2},0`;
}

// Helper to convert ellipse to path
function ellipseToPath(cx, cy, rx, ry) {
  return `M${cx-rx},${cy}a${rx},${ry} 0 1,0 ${rx*2},0a${rx},${ry} 0 1,0 -${rx*2},0`;
}

// Helper to convert rect to path
function rectToPath(x, y, w, h) {
  return `M${x},${y}L${x+w},${y}L${x+w},${y+h}L${x},${y+h}Z`;
}

// Extract all path data from SVG
function extractPathsFromSVG(svgContent) {
  const paths = [];

  // Extract <path d="..."/> elements
  const pathRegex = /<path[^>]*\sd="([^"]+)"/g;
  let match;
  while ((match = pathRegex.exec(svgContent)) !== null) {
    paths.push(match[1]);
  }

  // Extract <circle/> elements and convert to paths
  const circleRegex = /<circle[^>]*\scx="([^"]+)"[^>]*\scy="([^"]+)"[^>]*\sr="([^"]+)"/g;
  while ((match = circleRegex.exec(svgContent)) !== null) {
    const cx = parseFloat(match[1]);
    const cy = parseFloat(match[2]);
    const r = parseFloat(match[3]);
    paths.push(circleToPath(cx, cy, r));
  }

  // Extract <ellipse/> elements and convert to paths
  const ellipseRegex = /<ellipse[^>]*\scx="([^"]+)"[^>]*\scy="([^"]+)"[^>]*\srx="([^"]+)"[^>]*\sry="([^"]+)"/g;
  while ((match = ellipseRegex.exec(svgContent)) !== null) {
    const cx = parseFloat(match[1]);
    const cy = parseFloat(match[2]);
    const rx = parseFloat(match[3]);
    const ry = parseFloat(match[4]);
    paths.push(ellipseToPath(cx, cy, rx, ry));
  }

  // Extract <rect/> elements and convert to paths
  const rectRegex = /<rect[^>]*\sx="([^"]+)"[^>]*\sy="([^"]+)"[^>]*\swidth="([^"]+)"[^>]*\sheight="([^"]+)"/g;
  while ((match = rectRegex.exec(svgContent)) !== null) {
    const x = parseFloat(match[1]);
    const y = parseFloat(match[2]);
    const w = parseFloat(match[3]);
    const h = parseFloat(match[4]);
    paths.push(rectToPath(x, y, w, h));
  }

  return paths.join(' ');
}

// Extract viewBox
function extractViewBox(svgContent) {
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);
  if (viewBoxMatch) {
    const [x, y, w, h] = viewBoxMatch[1].split(/\s+/).map(Number);
    return { x, y, w, h };
  }
  return { x: 0, y: 0, w: 100, h: 100 };
}

const files = [
  { file: 'Wireframe_Globe_nonrasterized_2.svg', name: 'Wireframe Globe' },
  { file: 'Saturn_1_nonrasterized.svg', name: 'Saturn' },
  { file: 'Arrow_nonrasterized-1.svg', name: 'Right Arrow' },
  { file: 'Atomic_1_nonrasterized.svg', name: 'Atomic' },
  { file: 'Dot_Grid_1_nonrasterized-1.svg', name: 'Dot Grid 1' },
  { file: 'Dot_Grid_2_nonrasterized-1.svg', name: 'Dot Grid 2' },
  { file: 'Vortex_1_nonrasterized-1.svg', name: 'Vortex 1' },
  { file: 'Sprocket_1_nonrasterized-1.svg', name: 'Sprocket 1' },
  { file: 'Sprocket_2_nonrasterized-1.svg', name: 'Sprocket 2' },
];

console.log('Extracting SVG paths...\n');

files.forEach(({ file, name }) => {
  const svgContent = readFileSync(`src/imports/${file}`, 'utf-8');
  const pathData = extractPathsFromSVG(svgContent);
  const viewBox = extractViewBox(svgContent);

  console.log(`// ${name}`);
  console.log(`svgPath: '${pathData}',`);
  console.log(`viewBox: { x: ${viewBox.x}, y: ${viewBox.y}, w: ${viewBox.w}, h: ${viewBox.h} },`);
  console.log('');
});
