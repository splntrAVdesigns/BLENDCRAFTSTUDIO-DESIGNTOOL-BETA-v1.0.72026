import { optimize } from 'svgo';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const svgFiles = [
  'Rounded_Square.svg',
  '4_Corner_Arrows.svg',
  'Retro_Blob_1.svg',
  'Retro_Blob_2.svg',
  'Wireframe_Globe.svg',
  'Border_Globe.svg',
  'Circular_Dots.svg',
  'Circular_Lines.svg',
  'Grid_Blocks_1.svg',
  'Grid_Blocks_2.svg',
];

const config = {
  plugins: [
    'removeDoctype',
    'removeXMLProcInst',
    'removeComments',
    'removeMetadata',
    'removeEditorsNSData',
    'cleanupAttrs',
    'mergeStyles',
    'inlineStyles',
    'minifyStyles',
    'cleanupIds',
    'removeUselessDefs',
    'cleanupNumericValues',
    'convertColors',
    'removeUnknownsAndDefaults',
    'removeNonInheritableGroupAttrs',
    'removeUselessStrokeAndFill',
    'removeViewBox',
    'cleanupEnableBackground',
    'removeHiddenElems',
    'removeEmptyText',
    'convertShapeToPath',
    'convertEllipseToCircle',
    'moveElemsAttrsToGroup',
    'moveGroupAttrsToElems',
    'collapseGroups',
    'convertPathData',
    'convertTransform',
    'removeEmptyAttrs',
    'removeEmptyContainers',
    'mergePaths',
    'removeUnusedNS',
    'sortDefsChildren',
    'removeTitle',
    'removeDesc',
  ],
};

const baseDir = 'src/imports';

console.log('Optimizing SVG files...\n');

for (const filename of svgFiles) {
  const inputPath = join(baseDir, filename);
  const outputPath = join(baseDir, `optimized_${filename}`);

  try {
    const svgString = readFileSync(inputPath, 'utf-8');
    const result = optimize(svgString, {
      path: inputPath,
      ...config,
    });

    writeFileSync(outputPath, result.data);

    const originalSize = (svgString.length / 1024).toFixed(2);
    const optimizedSize = (result.data.length / 1024).toFixed(2);
    const reduction = ((1 - result.data.length / svgString.length) * 100).toFixed(1);

    console.log(`✓ ${filename}`);
    console.log(`  ${originalSize} KB → ${optimizedSize} KB (${reduction}% reduction)\n`);
  } catch (error) {
    console.error(`✗ ${filename}: ${error.message}\n`);
  }
}

console.log('Done!');
