// Выгрузка всех отчётов Sber за 2025 год в Supabase
// Запуск: npm run build && node scripts/sber-sync-2025.mjs

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const envText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'), 'utf8')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const modPath = 'file://' + join(root, 'out', 'main', 'sber-api', 'index.js').replaceAll('\\', '/')
const { SberApi } = await import(modPath)
const require = (await import('node:module')).createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')

const api = new SberApi({ userDataDir: join(root, '.sber-data') })
await api.oauth.setTokens({
  accessToken: process.env.SBER_ACCESS_TOKEN,
  refreshToken: process.env.SBER_REFRESH_TOKEN,
  expiresAt: process.env.SBER_TOKEN_EXPIRES_IN,
  scope: process.env.SBER_SCOPES
})
console.log('[1] Токены установлены')

const account = process.env.SBER_SANDBOX_ACCOUNT_NUMBER
const rangeFrom = '2025-01-01'
const rangeTo = '2025-12-31'

console.log(`[2] Запрос выписки: счёт ${account.slice(-4)}…, период ${rangeFrom} … ${rangeTo}`)
const fetched = await api.sync.fetchAndStage({ accountNumber: account, fromDate: rangeFrom, toDate: rangeTo })
console.log(`    получено: ${fetched.fetched}, входящих: ${fetched.incoming}, исходящих: ${fetched.outgoing}, дублей: ${fetched.duplicates}, отброшено: ${fetched.rejected}`)

const prepared = await api.sync.toTransactionRows()
console.log(`[3] Готово к записи: ${prepared.rows.length}`)

if (!prepared.rows.length) {
  console.log('[4] Записывать нечего — выписка за 2025 год пуста.')
  process.exit(0)
}

const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
})
const { data: fund } = await admin.from('funds').select('id').limit(1).single()
const { data: existing } = await admin.from('transactions').select('bank_transaction_id').eq('data_source', 'sber_api')
const known = new Set((existing || []).map((r) => r.bank_transaction_id))
const toInsert = prepared.rows.filter((r) => !known.has(r.bank_transaction_id)).map((r) => ({ ...r, fund_id: fund.id, user_id: null }))
let inserted = toInsert.length
const duplicates = prepared.rows.length - toInsert.length
const errors = []

for (let i = 0; i < toInsert.length; i += 200) {
  const batch = toInsert.slice(i, i + 200)
  const { error } = await admin.from('transactions').insert(batch)
  if (error) errors.push(error.message)
}

console.log(`[4] Запись: добавлено ${inserted}, дублей пропущено ${duplicates}`)
if (errors.length) console.log('    ОШИБКИ:', errors)

const { count } = await admin.from('transactions')
  .select('id', { count: 'exact', head: true })
  .eq('data_source', 'sber_api')
console.log(`[5] В БД записей с data_source='sber_api': ${count}`)
console.log(count > 0 ? '\n✔ ОТЧЁТЫ SBER ЗА 2025 ГОД В SUPABASE' : '\n✘ В БД пусто — см. логи выше')
