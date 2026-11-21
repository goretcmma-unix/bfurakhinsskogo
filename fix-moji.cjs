const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, 'src');

function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (/\.(ts|tsx|js|jsx|css|json|html|md)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Unicode -> CP1251 byte for 0x80-0xFF
const map = new Map();
for (let b = 0; b < 0x80; b++) map.set(b, b);
const tbl = [
  0x0402,0x0403,0x201A,0x0453,0x201E,0x2026,0x2020,0x2021,0x20AC,0x2030,0x0409,0x2039,0x040A,0x040C,0x040B,0x040F,
  0x0452,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0,     0x2122,0x0459,0x203A,0x045A,0x045C,0x045B,0x045F,
  0x00A0,0x040E,0x045E,0x0408,0x00A4,0x0490,0x00A6,0x00A7,0x0401,0x00A9,0x0404,0x00AB,0x00AC,0x00AD,0x00AE,0x0407,
  0x00B0,0x00B1,0x0406,0x0456,0x0491,0x00B5,0x00B6,0x00B7,0x0451,0x2116,0x0454,0x00BB,0x0458,0x0405,0x0455,0x0457
];
for (let i = 0; i < 0x20; i++) { if (tbl[i]) map.set(tbl[i], 0x80 + i); }
for (let i = 0; i < 0x20; i++) map.set(tbl[0x20 + i], 0xA0 + i);
for (let i = 0; i < 64; i++) map.set(0x0410 + i, 0xC0 + i);

function tryDecode(seg) {
  const bytes = [];
  for (let i = 0; i < seg.length; i++) {
    const c = seg.charCodeAt(i);
    const b = map.get(c);
    if (b === undefined) return null;
    bytes.push(b);
  }
  try {
    const dec = Buffer.from(bytes).toString('utf8');
    if (dec.includes('\uFFFD')) return null;
    return dec;
  } catch { return null; }
}

function cyr(s) { return (s.match(/[\u0400-\u04FF]/g) || []).length; }
function bad(s) { return (s.match(/Р[\u0400-\u04FF]|С[\u0400-\u04FF]|вЂ|в†|в„/g) || []).length; }

function fixContent(content) {
  if (!/Р[\u0400-\u04FF\u2019\u2018\u201c\u201d]|С[\u0400-\u04FF\u2019\u2018\u201c\u201d]|вЂ|в†/.test(content)) return content;
  // replace runs of chars that can be in cp1251
  return content.replace(/[\u00A0-\u00FF\u0400-\u04FF\u201A-\u203A\u20AC\u2122\u2116]+/g, (seg) => {
    if (!/Р[\u0400-\u04FF]|С[\u0400-\u04FF]|вЂ|в†|в„/.test(seg)) return seg;
    const dec = tryDecode(seg);
    if (!dec) return seg;
    if (cyr(dec) >= cyr(seg) && bad(dec) < bad(seg)) return dec;
    return seg;
  });
}

let changed = [];
for (const f of walk(root)) {
  const orig = fs.readFileSync(f, 'utf8');
  const fixed = fixContent(orig);
  if (fixed !== orig) {
    fs.writeFileSync(f, fixed, 'utf8');
    changed.push(path.relative(path.join(root, '..'), f));
  }
}
console.log(changed.join('\n') || 'none');
