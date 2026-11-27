#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'public-site', 'data.json');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY (or SUPABASE_URL/SUPABASE_ANON_KEY)');
  process.exit(1);
}

const endpoint = new URL('/rest/v1/public_transactions', SUPABASE_URL);
endpoint.searchParams.set('select', 'date,time,type,category,description,donor,amount,doc');
endpoint.searchParams.set('order', 'date.desc');
endpoint.searchParams.set('limit', '5000');

const resp = await fetch(endpoint, {
  headers: {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Accept: 'application/json',
  },
});

if (!resp.ok) {
  const text = await resp.text().catch(() => '');
  throw new Error(`Supabase HTTP ${resp.status}: ${text.slice(0, 300)}`);
}

const data = await resp.json();
if (!Array.isArray(data)) {
  throw new Error('Unexpected Supabase response: expected array');
}

// Реестровые платежи по ссылке Сбера не несут комментария плательщика:
// в описании только служебный текст и имя файла ЭЛ.РЕЕСТР EPS. Оставляем
// чистый заголовок категории и убираем этот текст из публичной таблицы.
const REGISTRY_MARKERS = [
  'ПО ПРИНЯТЫМ ПЛАТЕЖАМ', 'ЭЛ.РЕЕСТР', 'EPS', 'В Т.Ч.УСЛ.БАНКА',
];

function isRegistryPayment(description) {
  const text = String(description ?? '').toUpperCase();
  return REGISTRY_MARKERS.some((marker) => text.includes(marker));
}

const normalized = data.map((row) => {
  const sourceDescription = row?.description ?? '';
  const registryPayment = isRegistryPayment(sourceDescription);
  return {
    date: row?.date ?? '',
    time: row?.time ?? '',
    type: row?.type ?? '',
    category: registryPayment
      ? 'Благотворительное пожертвование'
      : (row?.category ?? ''),
    description: registryPayment ? '' : sourceDescription,
    donor: row?.donor ?? '',
    amount: Number(row?.amount ?? 0),
    doc: row?.doc ?? null,
  };
});

await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
await fs.writeFile(OUT_FILE, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
console.log(`Wrote ${normalized.length} rows to ${path.relative(ROOT, OUT_FILE)}`);
