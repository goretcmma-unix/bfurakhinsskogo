// Полный живой прогон: Sandbox → стейдж → строки БД → INSERT (аддитивно)
// Показывает фактические числа, без изменения существующих записей.
// --- .env ДОЛЖЕН быть загружен до импорта модуля (loadSberConfig читает process.env в конструкторе) ---
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

// 1. Токены: не перезаписываем свежие store-токены старыми значениями из .env
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

// 2. Реальный запрос выписки в Sandbox
const account = process.env.SBER_SANDBOX_ACCOUNT_NUMBER
const rangeTo = process.env.SBER_STATEMENT_DATE || new Date().toISOString().slice(0, 10)
const rangeFrom = process.env.SBER_STATEMENT_DATE
  ? process.env.SBER_STATEMENT_DATE
  : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

console.log(`[2] Запрос выписки: счёт ${account.slice(-4)}…, период ${rangeFrom} … ${rangeTo}`)
const fetched = await api.sync.fetchAndStage({ accountNumber: account, fromDate: rangeFrom, toDate: rangeTo })
console.log(`    получено: ${fetched.fetched}, входящих: ${fetched.incoming}, исходящих: ${fetched.outgoing}, дублей: ${fetched.duplicates}, отброшено: ${fetched.rejected}`)

// 3. Преобразование в строки таблицы transactions
const prepared = await api.sync.toTransactionRows()
console.log(`[3] Готово к записи: ${prepared.rows.length}`)
for (const r of prepared.rows.slice(0, 5)) {
  console.log(`    ${r.transaction_date} ${r.type.padEnd(7)} ${r.amount} ${r.currency} id=${String(r.bank_transaction_id).slice(0, 20)} «${String(r.description).slice(0, 30)}»`)
}

// 4. Запись в Supabase (upsert, ignoreDuplicates — CSV не трогаем)
if (!prepared.rows.length) {
  console.log('[4] Записывать нечего — выписка за период пуста. Попробуйте другую дату в SBER_STATEMENT_DATE.')
  await persistRefreshedTokens(api)
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

// 5. Контрольная читка из БД
const { count } = await admin.from('transactions')
  .select('id', { count: 'exact', head: true })
  .eq('data_source', 'sber_api')
console.log(`[5] В БД записей с data_source='sber_api': ${count}`)
console.log(count > 0 ? '\n✔ ДАННЫЕ СБЕРА В SUPABASE — дашборд их покажет' : '\n✘ В БД пусто — см. логи выше')
await persistRefreshedTokens(api)
