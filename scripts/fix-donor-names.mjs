#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const envText = await fs.readFile(path.join(ROOT, '.env'), 'utf8').catch(() => '');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Missing Supabase env');

const ORG_MARKERS = ['СБЕРБАНК','БАНК','ТБАНК','ТИНЬКОФФ','ВТБ','АЛЬФА','СБП','НСПК','ПАО','АО','ООО','ЦБ РФ','РОССЕЛЬХОЗБАНК','ГАЗПРОМБАНК','СОВКОМБАНК'];
const DONOR_STOPWORDS = new Set([
  'ЧАСТНОЕ','ЛИЦО','ФИЗ','ПЕРЕВОД','СРЕДСТВ','ОПЛАТА','ПОЖЕРТВОВАНИЕ','САДАКА','САДАКЪА','ДОНАТ','ПЛАТЕЖ','ПЛАТЁЖ',
  'БЕЗНАЛИЧНЫЙ','КАРТА','СЧЕТ','СЧЁТ','МОБИЛЬНОГО','БАНКА','КЛИЕНТ','ПОЛУЧАТЕЛЬ','ОТПРАВИТЕЛЬ',
  'ДЛЯ','ОТ','ЗА','НА','ПО','БЕЗ','ПРИ','ВО','ДО','ИЗ','ОБ','ПОД','НАД','ЧЕРЕЗ',
  'ПОМОЩЬ','ФОНД','СБОР','ЦЕЛЕВОЙ','НУЖДЫ','БЛАГО','МИЛОСТЫНЯ','ЗАКЯТ','ФИТР','ПОЖЕРТВ','ХАДИЯ',
  'НДС','БЛАГОТВОРИТЕЛЬНОСТЬ','БЛАГОТВОРИТЕЛЬНЫЙ','ВЗНОС','ДАР','ЦЕЛЕВОЕ','НАЗНАЧЕНИЕ',
  'НЕ','НЕТ','ДА','ПОЖЕРТВОВАНИЯ','ПОЖЕРТВОВАНИЙ','ПОЖЕРТВОВАНИЮ','ПОЖЕРТВОВАНИЕМ'

]);
const ADDRESS_TOKENS = new Set(['УЛ','УЛИЦА','ПЕР','ПРТ','ПРОСП','ПРОСПЕКТ','БР','БУЛЬВАР','ШОССЕ','ГОР','ГОРОД','СЕЛО','ПОС','ПОСЕЛОК','ПОСЁЛОК','ДОМ','КВ','КОРП','КОРПУС','СТР','СТРОЕНИЕ','РЕСП','РЕСПУБЛИКА','ОБЛ','ОБЛАСТЬ','РН','РАЙОН','КРАЙ','РЕГИОН','МОСКВА','САНКТ','ПЕТЕРБУРГ']);
const TYPO_MAP = { 'ААЛИЕВА': 'АЛИЕВА' };

const hasOrgMarker = (v) => ORG_MARKERS.some(m => String(v ?? '').toUpperCase().includes(m));
function cutDonorNoise(value) {
  let s = String(value ?? '');
  s = s.split(/\bИНН\b/i)[0];
  s = s.split(/\bтел\.?\b/i)[0];
  s = s.split(/\bсчет[а]?\b/i)[0];
  s = s.split(/\bсч[её]т\b/i)[0];
  s = s.split(/\bкарта\b/i)[0];
  s = s.split('//')[0];
  s = s.split(';')[0];
  s = s.split(',')[0];
  s = s.split('(')[0];
  return s;
}
function sanitizeFioCandidate(value) {
  let s = cutDonorNoise(String(value ?? ''));
  s = s.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
  s = s.replace(/\b\d{6}\b/g, ' ');
  s = s.replace(/\b\d+[а-яА-ЯёЁ]?\b/g, ' ');
  s = s.replace(/[^\p{L}\s-]/gu, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const rawWords = s.split(/\s+/).filter(Boolean);
  const words = [];
  for (const w of rawWords) {
    const upper = w.toUpperCase();
    if (ADDRESS_TOKENS.has(upper)) continue;
    if (DONOR_STOPWORDS.has(upper)) continue;
    if (ORG_MARKERS.some(m => upper.includes(m))) continue;
    if (!/^[А-ЯЁа-яё-]+$/.test(w)) continue;
    const lettersOnly = w.replace(/-/g, '');
    if (lettersOnly.length > 25) continue;
    if (lettersOnly.length < 2 && !/^[А-ЯЁа-яё]$/.test(w)) continue;
    words.push(w);
  }
  const cleaned = words.filter(w => /^[А-ЯЁа-яё-]+$/.test(w) && w.replace(/-/g, '').length <= 25 && !DONOR_STOPWORDS.has(w.toUpperCase()));
  if (cleaned.length < 2) return null;
  if (cleaned.every(w => w.replace(/-/g, '').length === 1)) return null;
  const normalized = cleaned.slice(0, 3).map(w => w.toUpperCase());
  const surname = TYPO_MAP[normalized[0]] ?? normalized[0];
  const initials = normalized.slice(1).map(w => w.replace(/[^А-ЯЁ-]/g, '')).filter(Boolean);
  if (initials.length === 0) return null;
  const formattedInitials = initials.map(w => (w.length === 1 ? `${w}.` : `${w[0]}.`));
  return `${surname} ${formattedInitials.join(' ')}`.trim();
}
function extractFioFromPurpose(purpose) {
  const raw = String(purpose ?? '').trim();
  if (!raw) return null;
  const segments = raw.split('//').map(s => s.trim()).filter(Boolean);
  const candidates = [];
  for (const re of [/\bот\s+([А-ЯЁа-яё-]+(?:\s+[А-ЯЁа-яё-]+){1,3})/i, /\bплательщик\s*[:\-]\s*([А-ЯЁа-яё-]+(?:\s+[А-ЯЁа-яё-]+){1,3})/i, /\bФИО\s*[:\-]\s*([А-ЯЁа-яё-]+(?:\s+[А-ЯЁа-яё-]+){1,3})/i]) {
    const m = raw.match(re);
    if (m?.[1]) candidates.push(m[1]);
  }
  candidates.push(...segments);
  for (const c of candidates) {
    const cleaned = sanitizeFioCandidate(c);
    if (cleaned) return cleaned;
  }
  return null;
}
function resolveDonorName(rawName, purpose, type) {
  if (type !== 'income') return rawName ?? null;
  const name = String(rawName ?? '').trim();
  const purposeText = String(purpose ?? '').trim();
  if (name && !hasOrgMarker(name)) {
    const fromName = sanitizeFioCandidate(name);
    if (fromName) return fromName;
  }
  const fromPurpose = extractFioFromPurpose(purposeText);
  if (fromPurpose) return fromPurpose;
  if (purposeText || (name && hasOrgMarker(name))) return 'Частное лицо';
  return 'Частное лицо';
}

async function sb(pathname, init = {}) {
  const res = await fetch(new URL(pathname, SUPABASE_URL), {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: init.prefer || 'return=minimal',
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0,500)}`);
  return json;
}

const dryRun = process.env.DRY_RUN === '1';
let offset = 0;
const pageSize = 1000;
let changed = 0;
let scanned = 0;
while (true) {
  const rows = await sb(`/rest/v1/transactions?select=id,type,sender_name,description&order=id.asc&limit=${pageSize}&offset=${offset}`, { method: 'GET', headers: { Prefer: '' } });
  if (!Array.isArray(rows) || rows.length === 0) break;
  for (const r of rows) {
    scanned++;
    if (r.type !== 'income') continue;
    const next = resolveDonorName(r.sender_name, r.description, r.type);
    const prev = r.sender_name ?? null;
    if (next !== prev) {
      changed++;
      if (changed <= 20) console.log('CHANGE', r.id, JSON.stringify(prev), '=>', JSON.stringify(next));
      if (!dryRun) {
        await sb(`/rest/v1/transactions?id=eq.${encodeURIComponent(r.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ sender_name: next })
        });
      }
    }
  }
  offset += rows.length;
  if (rows.length < pageSize) break;
}
console.log(JSON.stringify({ scanned, changed, dryRun }));
