const fs = require('fs');
const file = 'C:\\Users\\goret\\OneDrive\\Рабочий стол\\Dashboard Charity\\src\\pages\\OperationsPage.tsx';
const bytes = fs.readFileSync(file);

// Build CP1251 byte -> Unicode map
const cp1251ToUnicode = new Map();
const table = [
  0x0402,0x0403,0x201A,0x0453,0x201E,0x2026,0x2020,0x2021,0x20AC,0x2030,0x0409,0x2039,0x040A,0x040C,0x040B,0x040F,
  0x0452,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0,0x2122,0x0459,0x203A,0x045A,0x045C,0x045B,0x045F,
  0x00A0,0x040E,0x045E,0x0408,0x00A4,0x0490,0x00A6,0x00A7,0x0401,0x00A9,0x0404,0x00AB,0x00AC,0x00AD,0x00AE,0x0407,
  0x00B0,0x00B1,0x0406,0x0456,0x0491,0x00B5,0x00B6,0x00B7,0x0451,0x2116,0x0454,0x00BB,0x0458,0x0405,0x0455,0x0457
];
for (let i = 0; i < 0x20; i++) if (table[i]) cp1251ToUnicode.set(0x80 + i, table[i]);
for (let i = 0; i < 0x20; i++) cp1251ToUnicode.set(0xA0 + i, table[0x20 + i]);
for (let i = 0; i < 64; i++) cp1251ToUnicode.set(0xC0 + i, 0x0410 + i);

const unicodeToCp1251 = new Map();
for (const [b, u] of cp1251ToUnicode) unicodeToCp1251.set(u, b);

function tryDecode(seg) {
  const bytesArr = [];
  for (let i = 0; i < seg.length; i++) {
    const c = seg.charCodeAt(i);
    const b = unicodeToCp1251.get(c);
    if (b === undefined) return null;
    bytesArr.push(b);
  }
  const dec = Buffer.from(bytesArr).toString('utf8');
  if (dec.includes('\uFFFD')) return null;
  if (!/[\u0400-\u04FF]/.test(dec)) return null;
  return dec;
}

function hasMojibake(s) {
  return /[РС][\u0400-\u04FF\u00A0-\u00FF\u201A-\u203A\u20AC\u2122\u2116]/.test(s);
}

// Decode as UTF-8 to get current text
let text = bytes.toString('utf8');

// Apply fix only to mojibake sequences
let fixed = text.replace(
  /[\u00A0-\u00FF\u0400-\u04FF\u201A-\u203A\u20AC\u2122\u2116]+/g,
  (seg) => {
    if (!hasMojibake(seg)) return seg;
    const dec = tryDecode(seg);
    if (!dec) return seg;
    if (!hasMojibake(dec) && /[\u0400-\u04FF]/.test(dec)) return dec;
    return seg;
  }
);

// Verify: check that normal Russian lines are unchanged
const origLines = text.split('\n');
const fixedLines = fixed.split('\n');
let changedLines = 0;
for (let i = 0; i < origLines.length; i++) {
  if (origLines[i] !== fixedLines[i]) {
    changedLines++;
    if (changedLines <= 5) {
      console.log(`Line ${i+1} changed:`);
      console.log(`  BEFORE: ${origLines[i].substring(0, 120)}`);
      console.log(`  AFTER:  ${fixedLines[i].substring(0, 120)}`);
    }
  }
}
console.log(`Total changed lines: ${changedLines}`);

// Verify no mojibake remains
const remaining = (fixed.match(/[РС][\u0400-\u04FF\u00A0-\u00FF\u201A-\u203A\u20AC\u2122\u2116]/g) || []);
console.log(`Remaining mojibake: ${remaining.length}`);

if (remaining.length === 0) {
  fs.writeFileSync(file, fixed, 'utf8');
  console.log('File written successfully');
} else {
  console.log('NOT writing file - mojibake still present');
}