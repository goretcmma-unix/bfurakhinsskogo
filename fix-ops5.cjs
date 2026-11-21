const fs = require('fs');
const iconv = require('iconv-lite');

const file = 'C:\\Users\\goret\\OneDrive\\Рабочий стол\\Dashboard Charity\\src\\pages\\OperationsPage.tsx';

// Read raw bytes
const bytes = fs.readFileSync(file);

// Decode as CP1251 to get original text
let text = iconv.decode(bytes, 'cp1251');

// Re-encode as UTF-8
const utf8Buffer = iconv.encode(text, 'utf8');

// Write back
fs.writeFileSync(file, utf8Buffer);

// Verify
const verify = fs.readFileSync(file).toString('utf8');
const mojibake = (verify.match(/[РС][\u0400-\u04FF\u00A0-\u00FF\u201A-\u203A\u20AC\u2122\u2116]/g) || []);
console.log('Remaining mojibake matches:', mojibake.length);
if (mojibake.length > 0) {
  const lines = verify.split('\n');
  lines.forEach((line, i) => {
    if (/[РС][\u0400-\u04FF\u00A0-\u00FF\u201A-\u203A\u20AC\u2122\u2116]/.test(line)) {
      console.log(`Line ${i+1}: ${line.trim().substring(0, 150)}`);
    }
  });
}