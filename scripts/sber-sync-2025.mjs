// Выгрузка всех отчётов Sber за 2025 год в Supabase
// Запуск: npm run build && node scripts/sber-sync-2025.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(rootDir, '.env')
const envText = readFileSync(envPath, 'utf8')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
}

function upsertEnvValue(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm')
  const line = `${key}=${value ?? ''}`
  if (re.test(text)) return text.replace(re, line)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  return text.replace(/\s*$/, '') + eol + line + eol
}

async function persistRefreshedTokens(api) {
  try {
    const pair = await api.store.loadTokens()
    if (!pair?.accessToken) return
    let next = readFileSync(envPath, 'utf8')
    next = upsertEnvValue(next, 'SBER_ACCESS_TOKEN', pair.accessToken || '')
    next = upsertEnvValue(next, 'SBER_REFRESH_TOKEN', pair.refreshToken || '')
    // Сохраняем TTL/expiry в том виде, в каком поле используется в .env.
    if (pair.expiresAt) next = upsertEnvValue(next, 'SBER_TOKEN_EXPIRES_IN', new Date(pair.expiresAt).toISOString())
    if (next !== readFileSync(envPath, 'utf8')) {
      writeFileSync(envPath, next, 'utf8')
      console.log('[env] Обновлены SBER_* токены в .env (refresh rotation сохранён)')
    }
  } catch (e) {
    console.warn('[env] Не удалось сохранить обновлённые токены в .env:', e?.message || e)
  }
}

const modPath = 'file://' + join(rootDir, 'out', 'main', 'sber-api', 'index.js').replaceAll('\\', '/')
const { SberApi } = await import(modPath)
const require = (await import('node:module')).createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')

const api = new SberApi({ userDataDir: join(rootDir, '.sber-data') })
const storePair = await api.store.loadTokens().catch(() => null)
const envAccess = (process.env.SBER_ACCESS_TOKEN || '').trim()
const envRefresh = (process.env.SBER_REFRESH_TOKEN || '').trim()
const envChanged = envAccess && envAccess !== (storePair?.accessToken || '')

if (envChanged || !storePair?.refreshToken) {
  await api.oauth.setTokens({
    accessToken: envAccess,
    refreshToken: envRefresh,
    expiresAt: process.env.SBER_TOKEN_EXPIRES_IN,
    scope: process.env.SBER_SCOPES
  })
  console.log('[1] Токены установлены из .env')
} else {
  console.log('[1] Используются сохранённые токены из .sber-data (не перезаписываю .env-токенами)')
}

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
  await persistRefreshedTokens(api)
  process.exit(0)
}

const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim()
if (!supabaseKey) throw new Error('Нет SUPABASE_SERVICE_ROLE_KEY или VITE_SUPABASE_ANON_KEY в .env')
const admin = createClient(process.env.VITE_SUPABASE_URL, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
})
const { data: fund, error: fundError } = await admin.from('funds').select('id').limit(1).single()
if (fundError || !fund?.id) {
  await persistRefreshedTokens(api)
  throw new Error(`Не удалось получить fund_id из Supabase: ${fundError?.message || 'fund not found'}. Для записи после RLS нужен SUPABASE_SERVICE_ROLE_KEY в .env.`)
}
const { data: existing, error: existingError } = await admin.from('transactions').select('bank_transaction_id').eq('data_source', 'sber_api')
if (existingError) {
  await persistRefreshedTokens(api)
  throw new Error(`Не удалось прочитать существующие sber_api транзакции: ${existingError.message}`)
}
const known = new Set((existing || []).map((r) => r.bank_transaction_id))
const toInsert = prepared.rows.filter((r) => !known.has(r.bank_transaction_id)).map((r) => ({ ...r, fund_id: fund.id, user_id: null }))
const duplicates = prepared.rows.length - toInsert.length
const errors = []
let inserted = 0

for (let i = 0; i < toInsert.length; i += 200) {
  const batch = toInsert.slice(i, i + 200)
  const { error } = await admin.from('transactions').insert(batch)
  if (error) errors.push(error.message)
  else inserted += batch.length
}

console.log(`[4] Запись: добавлено ${inserted}, дублей пропущено ${duplicates}`)
if (errors.length) console.log('    ОШИБКИ:', errors)

const { count } = await admin.from('transactions')
  .select('id', { count: 'exact', head: true })
  .eq('data_source', 'sber_api')
console.log(`[5] В БД записей с data_source='sber_api': ${count}`)
console.log(count > 0 ? '\n✔ ОТЧЁТЫ SBER ЗА 2025 ГОД В SUPABASE' : '\n✘ В БД пусто — см. логи выше')
await persistRefreshedTokens(api)
