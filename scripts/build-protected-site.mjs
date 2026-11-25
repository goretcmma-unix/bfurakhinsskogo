import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { minify } from 'html-minifier-terser';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src-site');
const outDir = path.join(root, 'public-site');
const srcHtml = path.join(srcDir, 'index.html');
const outHtml = path.join(outDir, 'index.html');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const VALID_CLASS = /^[_A-Za-z][\w-]*$/;

function randomClass() {
  const bytes = crypto.randomBytes(5);
  let name = '_';
  for (const byte of bytes) name += ALPHABET[byte % ALPHABET.length];
  return name;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function obfuscate(code, heavy = false) {
  return JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    controlFlowFlattening: heavy,
    controlFlowFlatteningThreshold: heavy ? 0.4 : 0,
    deadCodeInjection: heavy,
    deadCodeInjectionThreshold: heavy ? 0.2 : 0,
    identifierNamesGenerator: 'hexadecimal',
    numbersToExpressions: heavy,
    renameGlobals: false,
    rotateStringArray: true,
    selfDefending: false,
    simplify: true,
    stringArray: true,
    stringArrayEncoding: ['rc4'],
    stringArrayThreshold: 1,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
    log: false
  }).getObfuscatedCode().replace(/\r\n|\r|\n/g, '\\n');
}

async function copyAssets(from, to) {
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(target, { recursive: true });
      await copyAssets(source, target);
    } else if (entry.name !== 'index.html') {
      await fs.copyFile(source, target);
    }
  }
}

async function build() {
  let html = await fs.readFile(srcHtml, 'utf8');

  // 1. Collect every class used in CSS, markup and JS.
  const classes = new Set();
  const addClass = (value) => {
    if (VALID_CLASS.test(value)) classes.add(value);
  };
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const cls of match[1].matchAll(/\.([_a-zA-Z][\w-]*)/g)) addClass(cls[1]);
  }
  for (const match of html.matchAll(/\bclass\s*=\s*["']([^"']+)["']/g)) {
    for (const cls of match[1].split(/\s+/)) addClass(cls);
  }
  for (const match of html.matchAll(/classList\.(?:add|remove|toggle|contains)\s*\(\s*["']([^"']+)["']/g)) {
    addClass(match[1]);
  }
  for (const match of html.matchAll(/(?:querySelector|querySelectorAll|getElementsByClassName)\s*\(\s*["']\.([^"']+)["']/g)) {
    for (const cls of match[1].split(/\s+/)) addClass(cls);
  }
  for (const match of html.matchAll(/\bclassName\s*=\s*["']([^"']+)["']/g)) {
    for (const cls of match[1].split(/\s+/)) addClass(cls);
  }

  const names = [...classes].filter((cls) => !cls.startsWith('_')).sort((a, b) => b.length - a.length);
  const classMap = new Map();
  const taken = new Set();
  for (const cls of names) {
    let hashed = randomClass();
    while (taken.has(hashed)) hashed = randomClass();
    classMap.set(cls, hashed);
    taken.add(hashed);
  }

  // 2. Dynamic class construction cannot be renamed by plain token replacement.
  //    Replace it with lookup placeholders first, then restore after renaming.
  const dynamicTokens = [];
  const families = new Map();
  const suffixes = new Set();
  for (const cls of classMap.keys()) {
    const dash = cls.indexOf('-');
    if (dash < 1) continue;
    const family = cls.slice(0, dash);
    const suffix = cls.slice(dash + 1);
    suffixes.add(suffix);
    if (!families.has(family)) families.set(family, {});
    families.get(family)[suffix] = classMap.get(cls);
  }

  // Families such as `row-${type}` may have no matching CSS rule at all —
  // they still need a generated name for every possible runtime suffix.
  const existingFamilies = new Set(families.keys());
  const dynamicFamilies = new Set(existingFamilies);
  for (const match of html.matchAll(/class="([a-z][\w-]*)-\$\{/g)) dynamicFamilies.add(match[1]);
  for (const match of html.matchAll(/'\.[a-z][\w-]*-'\s*\+/g)) {
    dynamicFamilies.add(match[0].slice(2, match[0].indexOf("-'")));
  }
  const commonSuffixes = new Set(['income', 'expense']);
  for (const suffix of suffixes) {
    const uses = [...existingFamilies].filter((family) => families.get(family)[suffix]).length;
    if (uses >= 2) commonSuffixes.add(suffix);
  }
  for (const family of dynamicFamilies) {
    if (existingFamilies.has(family)) continue;
    families.set(family, {});
    for (const suffix of commonSuffixes) {
      let hashed = randomClass();
      while (taken.has(hashed)) hashed = randomClass();
      families.get(family)[suffix] = hashed;
      taken.add(hashed);
    }
  }

  html = html.replace(/'\.[a-z][\w-]*-'\s*\+\s*([A-Za-z_$][\w$]*)/g, (full, variable) => {
    const family = full.slice(2, full.indexOf("-'"));
    const token = `__DYN${dynamicTokens.length}__`;
    dynamicTokens.push(`'.' + window.__CLS.${family}[${variable}]`);
    return token;
  });

  html = html.replace(/class="([a-z][\w-]*)-\$\{([^}]+)\}"/g, (full, family, expr) => {
    const token = `__DYN${dynamicTokens.length}__`;
    dynamicTokens.push(`class="\${window.__CLS.${family}[${expr}] || ''}"`);
    return token;
  });

  // 3. Rename classes only where a class is actually used. A global token
  //    replacement would also rename ids, anchors and ordinary JS strings.
  const swapClasses = (text, dotted = false) => {
    let out = text;
    for (const [cls, hashed] of classMap) {
      const source = dotted ? `\\.${escapeRegExp(cls)}` : escapeRegExp(cls);
      const target = dotted ? `.${hashed}` : hashed;
      const prefix = dotted ? '' : '(?<![\\w-])';
      out = out.replace(new RegExp(`${prefix}${source}(?![\\w-])`, 'g'), () => target);
    }
    return out;
  };

  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (full, css) =>
    full.replace(css, () => swapClasses(css, true))
  );

  // Interpolations inside class="..." are JavaScript expressions, not class names.
  const swapInterpolatedClasses = (expr) => expr.replace(/(['"])([^'"]*)\1/g,
    (full, quote, value) => quote + swapClasses(value) + quote);
  const swapClassAttribute = (value) => value.replace(/(\$\{[^}]*\})|([^$]+)/g,
    (full, expr, literal) => expr ? swapInterpolatedClasses(expr) : swapClasses(literal));

  html = html.replace(/\bclass\s*=\s*(["'])([\s\S]*?)\1/g, (full, quote, value) =>
    'class=' + quote + swapClassAttribute(value) + quote
  );

  html = html.replace(/(classList\.(?:add|remove|toggle|contains)\s*\(\s*)(["'])([^"']+)\2/g,
    (full, prefix, quote, value) => prefix + quote + swapClasses(value) + quote);
  html = html.replace(/(getElementsByClassName\s*\(\s*)(["'])([^"']+)\2/g,
    (full, prefix, quote, value) => prefix + quote + swapClasses(value) + quote);
  html = html.replace(/(\bclassName\s*=\s*)(["'])([^"']+)\2/g,
    (full, prefix, quote, value) => prefix + quote + swapClasses(value) + quote);
  html = html.replace(/((?:querySelector|querySelectorAll)\s*\(\s*)(["'])([^"']+)\2/g,
    (full, prefix, quote, value) => prefix + quote + swapClasses(value, true) + quote);

  dynamicTokens.forEach((code, index) => {
    html = html.split(`__DYN${index}__`).join(code);
  });

  // 3. Protect images from drag/context menu/selection.
  html = html.replace(/<img\b/gi, '<img draggable="false" oncontextmenu="return false"');
  html = html.replace(/<\/style>/i, 'img,svg{-webkit-user-drag:none;user-select:none;-webkit-user-select:none}</style>');

  // 4. Take scripts out of the body payload — innerHTML will not execute them.
  const bodyScripts = [];
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) throw new Error('src-site/index.html has no <body>');
  let payload = bodyMatch[1].replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (full, attrs, code) => {
    const typeMatch = attrs.match(/type\s*=\s*["']?([^"'\s>]+)/i);
    const type = typeMatch ? typeMatch[1] : '';
    if (type && type !== 'module' && type !== 'text/javascript' && type !== 'application/javascript') return full;
    bodyScripts.push({ t: type, s: code });
    return '';
  });

  const encoded = Buffer.from(payload, 'utf8').toString('base64');

  // The body logic is obfuscated into a same-origin bundle. Loading it by src
  // keeps the strict CSP intact: eval and blob: URLs are both disallowed.
  const bundleCode = bodyScripts
    .map((item) => (item.t === 'module' ? "'use strict';\n" : '') + item.s)
    .join('\n;\n');
  const bundleHash = crypto.createHash('sha256').update(bundleCode).digest('hex').slice(0, 10);
  const bundleName = 'bundle.js';
  const bundleUrl = `${bundleName}?v=${bundleHash}`;
  const protectedBundle = obfuscate(bundleCode, true);

  const loader = `
(function () {
  var payload = ${JSON.stringify(encoded)};
  window.__CLS = ${JSON.stringify(Object.fromEntries(families))};
  var app = document.getElementById('app');
  var bytes = atob(payload).split('').map(function (c) { return c.charCodeAt(0); });
  app.innerHTML = new TextDecoder().decode(new Uint8Array(bytes));
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('dragstart', function (e) { e.preventDefault(); });
  var script = document.createElement('script');
  script.src = ${JSON.stringify(bundleUrl)};
  document.body.appendChild(script);
})();
`;

  const protectedLoader = obfuscate(loader, true);

  // Head scripts stay executable before DOM is built, but are obfuscated too.
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (full, attrs, code) => {
    if (!code.trim()) return full;
    const typeMatch = attrs.match(/type\s*=\s*["']?([^"'\s>]+)/i);
    const type = typeMatch ? typeMatch[1] : '';
    if (type && type !== 'module' && type !== 'text/javascript' && type !== 'application/javascript') return full;
    return `<script${attrs}>${obfuscate(code)}</script>`;
  });

  // Use a function replacement: the obfuscated code may contain '$&', "$'", '$`' sequences,
  // which String.replace would otherwise expand when passed as a string.
  html = html.replace(
    /<body\b[^>]*>[\s\S]*?<\/body>/i,
    () => `<body oncontextmenu="return false"><div id="app"></div><script>${protectedLoader}</script></body>`
  );

  const result = await minify(html, {
    caseSensitive: true,
    collapseInlineTagWhitespace: true,
    collapseWhitespace: true,
    decodeEntities: false,
    minifyCSS: true,
    minifyJS: false,
    removeComments: true,
    removeEmptyAttributes: false,
    removeRedundantAttributes: false,
    removeScriptTypeAttributes: false,
    useShortDoctype: true
  });

  await fs.mkdir(outDir, { recursive: true });
  await copyAssets(srcDir, outDir);
  for (const file of await fs.readdir(outDir)) {
    if (/^bundle\.[a-f0-9]+\.js$/.test(file) && file !== bundleName) {
      await fs.unlink(path.join(outDir, file));
    }
  }
  await fs.writeFile(path.join(outDir, bundleName), protectedBundle, 'utf8');
  await fs.writeFile(outHtml, result, 'utf8');

  console.log(
    `build:site — classes ${classMap.size}, scripts ${bodyScripts.length}, ` +
    `payload ${(encoded.length / 1024).toFixed(1)} KB, bundle ${bundleUrl}, ` +
    `output ${(Buffer.byteLength(result) / 1024).toFixed(1)} KB`
  );
}

build().catch((error) => {
  console.error('[build:site] failed:', error);
  process.exitCode = 1;
});
