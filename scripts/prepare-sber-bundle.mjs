#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const stage = path.join(os.tmpdir(), 'sber-github-bundle');
const outFile = path.join(root, 'sber-github-secret.base64.txt');
const tarFile = path.join(os.tmpdir(), 'sber-github-bundle.tar.gz');

function parseEnv(text) {
  const env = {};
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[m[1]] = value;
  }
  return env;
}

async function copyIfMissingOrDifferent(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    const [a, b] = await Promise.all([fs.readFile(source), fs.readFile(target)]);
    if (a.equals(b)) return;
  } catch {
    // target does not exist or is unreadable — copy below
  }
  await fs.copyFile(source, target);
}

await fs.rm(stage, { recursive: true, force: true });
await fs.mkdir(path.join(stage, '.sber-tls'), { recursive: true });

const envPath = path.join(root, '.env');
let envText;
try {
  envText = await fs.readFile(envPath, 'utf8');
} catch {
  console.error('[sber-bundle] Не найден .env в корне проекта');
  process.exit(1);
}

const env = parseEnv(envText);
if (!env.SBER_P12_PATH || !env.SBER_CA_PATH) {
  console.error('[sber-bundle] В .env не заданы SBER_P12_PATH и/или SBER_CA_PATH');
  process.exit(1);
}

const p12Source = path.isAbsolute(env.SBER_P12_PATH) ? env.SBER_P12_PATH : path.join(root, env.SBER_P12_PATH);
const caSource = path.isAbsolute(env.SBER_CA_PATH) ? env.SBER_CA_PATH : path.join(root, env.SBER_CA_PATH);

try {
  await fs.access(p12Source);
  await fs.access(caSource);
} catch {
  console.error('[sber-bundle] Не найден сертификат Sber API (SBER_P12_PATH или SBER_CA_PATH)');
  process.exit(1);
}

try {
  await fs.access(path.join(root, '.sber-data'));
} catch {
  console.error('[sber-bundle] Не найдена папка .sber-data');
  process.exit(1);
}

await fs.cp(path.join(root, '.sber-data'), path.join(stage, '.sber-data'), {
  recursive: true,
  filter: (source) => !path.basename(source).includes('.bak_'),
});
await copyIfMissingOrDifferent(p12Source, path.join(stage, '.sber-tls', 'client.p12'));
await copyIfMissingOrDifferent(caSource, path.join(stage, '.sber-tls', 'ca.pem'));

const githubEnv = envText
  .replace(/^\uFEFF/, '')
  .split(/\r?\n/)
  .map((line) => {
    if (/^\s*SBER_P12_PATH\s*=/.test(line)) return 'SBER_P12_PATH=.sber-tls/client.p12';
    if (/^\s*SBER_CA_PATH\s*=/.test(line)) return 'SBER_CA_PATH=.sber-tls/ca.pem';
    return line;
  })
  .join('\n');
await fs.writeFile(path.join(stage, '.env'), githubEnv, 'utf8');

execFileSync('tar', ['-czf', tarFile, '-C', stage, '.sber-data', '.env', '.sber-tls'], { stdio: 'inherit' });
const archive = await fs.readFile(tarFile);
await fs.writeFile(outFile, archive.toString('base64'), 'ascii');

console.log(`[sber-bundle] Готово: ${outFile}`);
console.log(`[sber-bundle] Размер: ${(archive.toString('base64').length / 1024).toFixed(1)} KB base64`);
console.log('[sber-bundle] Скопируйте содержимое файла в GitHub Secret SBER_DATA_B64');
