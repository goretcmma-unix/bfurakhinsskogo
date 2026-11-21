// Полная пересборка .env: гарантированно UTF-8 без BOM, все значения на месте
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env')

// Читаем в обеих кодировках — берём ту, где есть ключи SBER
let raw = ''
for (const enc of ['utf8', 'utf16le']) {
  try {
    const t = fs.readFileSync(envPath, enc)
    if (t.includes('SBER_')) { raw = t; console.log('исходная кодировка:', enc); break }
  } catch { /* пробуем следующую */ }
}
if (!raw) { console.error('Не удалось прочитать .env'); process.exit(1) }
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1)

const certPath = 'C:\\Users\\goret\\OneDrive\\Рабочий стол\\Dashboard Charity\\certificates\\SBBAPI_98893_9e8c3b8c-8c7f-4469-96a5-60e709255785.p12'
const caPath = 'C:\\Users\\goret\\OneDrive\\Рабочий стол\\Dashboard Charity\\certificates\\2b1cfb94_prom-certs\\prom-certs\\sberapi-root-ca.cer'

// Собираем заново: существующие значения сохраняем, P12/CA принудительно исправляем
const wanted = {}
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_]+)=(.*)$/)
  if (m) wanted[m[1]] = m[2]
}
wanted['SBER_P12_PATH'] = certPath
wanted['SBER_CA_PATH'] = caPath

// Порядок: сначала Supabase, потом Sber-блок в логичном порядке
const order = [
  'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
  'SBER_API_ENV', 'SBER_CLIENT_ID', 'SBER_CLIENT_SECRET', 'SBER_REDIRECT_URI',
  'SBER_SCOPES', 'SBER_P12_PATH', 'SBER_P12_PASSWORD', 'SBER_CA_PATH',
  'SBER_ALLOW_INVALID_SERVER_CERT',
  'SBER_SANDBOX_BASE_URL', 'SBER_SANDBOX_TOKEN_URL',
  'SBER_SANDBOX_STATEMENT_ACCOUNT_PATH', 'SBER_SANDBOX_STATEMENT_TRANSACTION_PATH',
  'SBER_SANDBOX_ACCOUNT_NUMBER',
  'SBER_TOKEN_GRANT_TYPE', 'SBER_TOKEN_BODY_FORMAT', 'SBER_STATEMENT_METHOD',
  'SBER_STATEMENT_USE_PERIOD', 'SBER_AUTHORIZE_URL', 'SBER_TIMEZONE_OFFSET',
  'SBER_AUTO_SYNC_MINUTES',
  'SBER_ACCESS_TOKEN', 'SBER_REFRESH_TOKEN', 'SBER_TOKEN_EXPIRES_IN',
  'SBER_STORE_PASSPHRASE'
]

const outLines = ['# Supabase', '']
for (const k of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
  if (wanted[k]) outLines.push(`${k}=${wanted[k]}`)
}
outLines.push('', '# Sber API Sandbox', '')
for (const k of order.filter(k => !k.startsWith('VITE_'))) {
  if (wanted[k] !== undefined && wanted[k] !== '') outLines.push(`${k}=${wanted[k]}`)
  else if (wanted[k] === '') outLines.push(`${k}=`)
}

fs.writeFileSync(envPath, outLines.join('\n') + '\n', 'utf8')

// Контроль: каждая строка парсится стандартным regex
const verify = fs.readFileSync(envPath, 'utf8')
let ok = 0, bad = []
for (const line of verify.split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue
  if (/^([A-Za-z_]+)=(.*)$/.test(line)) ok++
  else bad.push(line.slice(0, 40))
}
console.log(`строк валидно: ${ok}, битых: ${bad.length}`)
if (bad.length) console.log('битые:', bad)
const p12 = verify.split(/\r?\n/).find(l => l.startsWith('SBER_P12_PATH='))
console.log('P12 путь валиден:', fs.existsSync(p12.split('=').slice(1).join('=')))
