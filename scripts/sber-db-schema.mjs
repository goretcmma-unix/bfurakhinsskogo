// Полная структура таблицы transactions через head-запрос (заголовки content-profile)
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const envText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'), 'utf8')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
}
const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY

// 1. Реальная строка — покажет фактические поля и значения (CSV-запись)
console.log('=== ПРИМЕР РЕАЛЬНОЙ ЗАПИСИ (CSV) ===')
let r = await fetch(`${url}/rest/v1/transactions?select=*&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` }
})
const rows = await r.json()
if (rows[0]) {
  for (const [k, v] of Object.entries(rows[0])) {
    const val = v === null ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    console.log(`  ${k.padEnd(26)} = ${val.slice(0, 60)}`)
  }
}

// 2. Проверка: есть ли записи со Сбера?
console.log('\n=== Записи с data_source=sber_api ===')
r = await fetch(`${url}/rest/v1/transactions?select=id,bank_transaction_id,data_source&data_source=eq.sber_api&limit=5`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` }
})
console.log('status:', r.status, '→', await r.text())

// 3. Проверка: есть ли вообще bank_transaction_id у CSV?
console.log('\n=== Записи с bank_transaction_id (любой источник) ===')
r = await fetch(`${url}/rest/v1/transactions?select=id,bank_transaction_id,data_source&bank_transaction_id=not.is.null&limit=5`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` }
})
console.log('status:', r.status, '→', await r.text())

// 4. Существует ли sber_sync_runs
console.log('\n=== Таблица sber_sync_runs ===')
r = await fetch(`${url}/rest/v1/sber_sync_runs?select=id&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` }
})
console.log('status:', r.status, '(404 = миграция НЕ применена)')

// 5. Пробуем вставить тест с data_source=sber_api и откатить? НЕТ — только читаем.
// Проверяем уникальный индекс попыткой дубля (без вставки — через information_schema недоступен anon)
