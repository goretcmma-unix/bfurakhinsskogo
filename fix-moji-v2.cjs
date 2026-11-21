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

// Build CP1251 -> Unicode table
const cp1251ToUnicode = new Map();
const cp1251Table = [
  0x0402,0x0403,0x201A,0x0453,0x201E,0x2026,0x2020,0x2021,0x20AC,0x2030,0x0409,0x2039,0x040A,0x040C,0x040B,0x040F,
  0x0452,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0,     0x2122,0x0459,0x203A,0x045A,0x045C,0x045B,0x045F,
  0x00A0,0x040E,0x045E,0x0408,0x00A4,0x0490,0x00A6,0x00A7,0x0401,0x00A9,0x0404,0x00AB,0x00AC,0x00AD,0x00AE,0x0407,
  0x00B0,0x00B1,0x0406,0x0456,0x0491,0x00B5,0x00B6,0x00B7,0x0451,0x2116,0x0454,0x00BB,0x0458,0x0405,0x0455,0x0457
];
for (let i = 0; i < 0x20; i++) { if (cp1251Table[i]) cp1251ToUnicode.set(0x80 + i, cp1251Table[i]); }
for (let i = 0; i < 0x20; i++) cp1251ToUnicode.set(0xA0 + i, cp1251Table[0x20 + i]);
for (let i = 0; i < 64; i++) cp1251ToUnicode.set(0xC0 + i, 0x0410 + i);

// Unicode -> CP1251 byte
const unicodeToCp1251 = new Map();
for (const [byte, unicode] of cp1251ToUnicode) unicodeToCp1251.set(unicode, byte);

function isCp1251Byte(b) {
  return (b >= 0x80 && b <= 0xFF);
}

function tryDecodeMojibake(seg) {
  // seg is a string of Unicode chars that came from CP1251 bytes mis-decoded as UTF-8
  // Convert each char back to its CP1251 byte, then decode as UTF-8
  const bytes = [];
  for (let i = 0; i < seg.length; i++) {
    const c = seg.charCodeAt(i);
    const b = unicodeToCp1251.get(c);
    if (b === undefined) return null;
    bytes.push(b);
  }
  try {
    const dec = Buffer.from(bytes).toString('utf8');
    if (dec.includes('\uFFFD')) return null;
    // Ensure the decoded result is valid Cyrillic text
    if (!/[\u0400-\u04FF]/.test(dec)) return null;
    return dec;
  } catch { return null; }
}

function cyrCount(s) { return (s.match(/[\u0400-\u04FF]/g) || []).length; }

// Mojibake patterns: sequences of chars that are CP1251 bytes mis-decoded
// Typical: "Р" (U+0420) followed by Cyrillic-looking chars, or "С" (U+0421) etc.
function hasMojibakePattern(s) {
  // Look for sequences like Р[а-яё] or С[а-яё] which indicate CP1251 mis-decoding
  return /[РС][\u0400-\u04FF\u00A0-\u00FF\u201A-\u203A\u20AC\u2122\u2116]/.test(s) ||
         /[РС][РС][\u0400-\u04FF]/.test(s);
}

function fixContent(content) {
  if (!hasMojibakePattern(content)) return content;

  // Find runs of characters that could be CP1251 bytes mis-decoded as UTF-8
  // These are chars in range U+00A0-U+00FF and U+0400-U+04FF plus some symbols
  const result = content.replace(
    /[\u00A0-\u00FF\u0400-\u04FF\u201A-\u203A\u20AC\u2122\u2116]+/g,
    (seg) => {
      if (!hasMojibakePattern(seg)) return seg;
      const dec = tryDecodeMojibake(seg);
      if (!dec) return seg;
      // Only accept if decoded has more/valid Cyrillic and fewer mojibake patterns
      if (cyrCount(dec) >= cyrCount(seg) && !hasMojibakePattern(dec)) {
        return dec;
      }
      return seg;
    }
  );
  return result;
}

let changed = [];
for (const f of walk(root)) {
  try {
    const orig = fs.readFileSync(f, 'utf8');
    const fixed = fixContent(orig);
    if (fixed !== orig) {
      fs.writeFileSync(f, fixed, 'utf8');
      changed.push(path.relative(path.join(root, '..'), f));
    }
  } catch (e) {
    console.error('Error processing ' + f + ': ' + e.message);
  }
}
console.log(changed.join('\n') || 'none');