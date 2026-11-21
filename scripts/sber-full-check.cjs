за// Чистая диагностика .env + полный живой прогон (без PowerShell-искажений)
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const envPath = path.join(root, '.env')
const txt = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '')

// 1. Проверка парсинга всех строк
let valid = 0, broken = []
for (const [i, line] of txt.split(/\r?\n/).entries()) {
  if (!line.trim() || line.startsWith('#')) continue
  if (/^([A-Za-z_]+)=(.*)$/.test(line)) valid++
  else broken.push({ n: i + 1, line: line.slice(0, 50) })
}
console.log(`[env] строк валидно: ${valid}, битых: ${broken.length}`)
if (broken.length) console.log('[env] битые:', broken)

// 2. Загрузка в process.env
for (const line of txt.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_]+)=(.*)$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
}

// 3. Критичные параметры
const required = ['SBER_P12_PATH', 'SBER_P12_PASSWORD', 'SBER_ACCESS_TOKEN', 'SBER_REFRESH_TOKEN', 'SBER_SANDBOX_ACCOUNT_NUMBER', 'VITE_SUPABASE_URL']
let allOk = true
for (const k of required) {
  const has = Boolean(process.env[k])
  if (!has) allOk = false
  console.log(`[env] ${k}: ${has ? 'OK (длина ' + process.env[k].length + ')' : 'ОТСУТСТВУЕТ'}`)
}

// 4. Файл сертификата
const p12exists = fs.existsSync(process.env.SBER_P12_PATH)
console.log(`[cert] файл p12 существует: ${p12exists}`)
if (!allOk || !p12exists) {
  console.log('\n[СТОП] Не все параметры заданы — продолжение невозможно.')
  process.exit(2)
}

// 5. Живой прогон через модуль приложения
async function main() {
  const modPath = 'file://' + path.join(root, 'out', 'main', 'sber-api', 'index.js').replaceAll('\\', '/')
  const { SberApi } = await import(modPath)
  const { createClient } = require('@supabase/supabase-js')

  const api = new SberApi({ userDataDir: path.join(root, '.sber-data') })
  await api.oauth.setTokens({
    accessToken: process.env.SBER_ACCESS_TOKEN,
    refreshToken: process.env.SBER_REFRESH_TOKEN,
    expiresAt: process.env.SBER_TOKEN_EXPIRES_IN,
    scope: process.env.SBER_SCOPES
  })
  console.log('\n[sync] токены установлены')

  const account = process.env.SBER_SANDBOX_ACCOUNT_NUMBER
  const toDate = process.env.SBER_STATEMENT_DATE || new Date().toISOString().slice(0, 10)
  const fromDate = process.env.SBER_STATEMENT_DATE
    ? process.env.SBER_STATEMENT_DATE
    : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  console.log(`[sync] запрос: счёт …${account.slice(-4)}, период ${fromDate} … ${toDate}`)
  const fetched = await api.sync.fetchAndStage({ accountNumber: account, fromDate, toDate })
  console.log(`[sync] получено: ${fetched.fetched}, входящих: ${fetched.incoming}, исходящих: ${fetched.outgoing}, дублей: ${fetched.duplicates}, отброшено: ${fetched.rejected}`)

  const prepared = await api.sync.toTransactionRows()
  console.log(`[db] подготовлено к записи: ${prepared.rows.length}`)
  for (const r of prepared.rows.slice(0, 5)) {
    console.log(`      ${r.transaction_date} ${String(r.type).padEnd(7)} ${r.amount} ${r.currency} «${String(r.description).slice(0, 30)}»`)
  }

  if (!prepared.rows.length) {
    console.log('\n[db] записывать нечего — выписка за период пуста. Задайте SBER_STATEMENT_DATE.')
    return
  }

  const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { data: fund } = await admin.from('funds').select('id').limit(1).single()

  let inserted = 0, dupl = 0, errors = []
  for (let i = 0; i < prepared.rows.length; i += 200) {
    const batch = prepared.rows.slice(i, i + 200).map(r => ({ ...r, fund_id: fund.id, user_id: null }))
    const { data, error } = await admin.from('transactions')
      .upsert(batch, { onConflict: 'fund_id,bank_transaction_id', ignoreDuplicates: true })
      .select('id')
    if (error) errors.push(error.message)
    else { inserted += data?.length ?? 0; dupl += batch.length - (data?.length ?? 0) }
  }
  console.log(`[db] записано: ${inserted}, дублей пропущено: ${dupl}`)
  if (errors.length) console.log('[db] ОШИБКИ:', errors.slice(0, 3))

  const { count } = await admin.from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('data_source', 'sber_api')
  console.log(`[db] всего в БД с data_source='sber_api': ${count}`)
  console.log(count > 0 ? '\n✔ ТРАНЗАКЦИИ СБЕРА В БД — дашборд их покажет' : '\n✘ в БД пусто')
}

main().catch(e => {
  console.error('\n[ОШИБКА]', e.message)
  if (/unknown p12|bad decrypt/i.test(e.message)) {
    console.error('Пароль от .p12 не подходит — проверьте SBER_P12_PASSWORD.')
  }
  process.exit(1)
})
