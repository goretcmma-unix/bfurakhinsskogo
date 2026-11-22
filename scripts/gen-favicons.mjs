import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const svgPath = path.resolve('public-site/fondlogotip.svg');
const outDir = path.resolve('public-site');
const svg = fs.readFileSync(svgPath, 'utf8');

// Strip XML declaration and outer svg tags to get inner content
const inner = svg
  .replace(/<\?xml[^>]*\?>\s*/, '')
  .replace(/<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .trim();

// Square canvas (554.99 = max of viewBox dims), centered
const squareSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="554.99" height="554.99" viewBox="0 0 554.99 554.99">
  <g transform="translate(${(554.99 - 527.11) / 2}, 0)">
${inner}
  </g>
</svg>
`;

const sizes = [
  { name: 'favicon-16x16.png', width: 16, height: 16 },
  { name: 'favicon-32x32.png', width: 32, height: 32 },
  { name: 'favicon-48x48.png', width: 48, height: 48 },
  { name: 'favicon-96x96.png', width: 96, height: 96 },
  { name: 'android-chrome-192x192.png', width: 192, height: 192 },
  { name: 'android-chrome-512x512.png', width: 512, height: 512 },
  { name: 'apple-touch-icon-180x180.png', width: 180, height: 180 },
];

for (const { name, width, height } of sizes) {
  await sharp(Buffer.from(squareSvg))
    .resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outDir, name));
  console.log('created', name);
}

await sharp(Buffer.from(squareSvg))
  .resize(48, 48, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toFile(path.join(outDir, 'favicon.ico'));
console.log('created favicon.ico');

// favicon.svg: biryuzyovyi lotoip (original #40E0D0 color)
const coloredSvg = `<?xml version="1.0" encoding="UTF-8"?>
${svg}`;
fs.writeFileSync(path.join(outDir, 'favicon.svg'), coloredSvg);
console.log('created favicon.svg');

// safari-pinned-tab.svg: black silhouette mask
const maskSvg = `<?xml version="1.0" encoding="UTF-8"?>
${svg.replace(/fill:\s*#40E0D0;/g, 'fill:#000000;').replace(/class="cls-1"/g, '')}`;
fs.writeFileSync(path.join(outDir, 'safari-pinned-tab.svg'), maskSvg);
console.log('created safari-pinned-tab.svg');

console.log('done');
