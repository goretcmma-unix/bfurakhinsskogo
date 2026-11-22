import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const svg = fs.readFileSync('public-site/fondlogotip.svg', 'utf8');
const inner = svg
  .replace(/<\?xml[^>]*\?>\s*/, '')
  .replace(/<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .trim();
const sq = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="554.99" height="554.99" viewBox="0 0 554.99 554.99">
  <g transform="translate(${(554.99 - 527.11) / 2}, 0)">
${inner}
  </g>
</svg>
`;
const out = 'public-site';

// GitHub social preview 1280x640
const logoBuf = await sharp(Buffer.from(sq))
  .resize(260, 260, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
await sharp({
  create: { width: 1280, height: 640, channels: 3, background: { r: 11, g: 13, b: 13 } },
})
  .composite([{ input: logoBuf, top: (640 - 260) / 2, left: (1280 - 260) / 2 }])
  .png()
  .toFile(path.join(out, 'github-social-preview.png'));
console.log('created github-social-preview.png 1280x640');

// GitHub avatar 256x256 (GitHub applies circle mask)
await sharp(Buffer.from(sq))
  .resize(256, 256, { fit: 'contain', background: { r: 11, g: 13, b: 13, alpha: 1 } })
  .png()
  .toFile(path.join(out, 'github-avatar.png'));
console.log('created github-avatar.png 256x256');

console.log('done');
