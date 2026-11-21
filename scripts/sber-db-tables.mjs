// Список таблиц в Supabase + проверка доступа к transactions
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const envText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'), 'utf8')
const env = {}
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
}
const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY

const res = await fetch(`${url}/rest/v1/?apikey=${key}`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` }
})
const spec = await res.json()
console.log('=== ВСЕ ТАБЛИЦЫ (через anon key) ===')
console.log(Object.keys(spec.definitions || {}).join('\n') || '(пусто)')
console.log('\npaths:', Object.keys(spec.paths || {}).slice(0, 30).join(', '))

// Прямая попытка прочитать 1 строку transactions
console.log('\n=== SELECT из transactions (anon) ===')
const r2 = await fetch(`${url}/rest/v1/transactions?select=id&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` }
})
console.log('status:', r2.status)
console.log(await r2.text())
