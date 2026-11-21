import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

const text = readFileSync('.env', 'utf8').replace(/^\uFEFF/, '')
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
}

// НЕ секреты — печатаем как есть
console.log('ENV               :', process.env.SBER_API_ENV)
console.log('USE_PERIOD        :', process.env.SBER_STATEMENT_USE_PERIOD)
console.log('STATEMENT_METHOD  :', process.env.SBER_STATEMENT_METHOD)
console.log('AUTO_SYNC_MINUTES :', process.env.SBER_AUTO_SYNC_MINUTES)
console.log('TOKEN_BODY_FORMAT :', process.env.SBER_TOKEN_BODY_FORMAT)
console.log('TOKEN_GRANT_TYPE  :', process.env.SBER_TOKEN_GRANT_TYPE)
console.log('PROD BASE_URL     :', process.env.SBER_PRODUCTION_BASE_URL)
console.log('PROD TOKEN_URL    :', process.env.SBER_PRODUCTION_TOKEN_URL)
console.log('PROD TX PATH      :', process.env.SBER_PRODUCTION_STATEMENT_TRANSACTION_PATH)
console.log('PROD ACC PATH     :', process.env.SBER_PRODUCTION_STATEMENT_ACCOUNT_PATH)
const acc = process.env.SBER_PRODUCTION_ACCOUNT_NUMBER || ''
console.log('ACCOUNT (masked)  :', acc ? `****${acc.slice(-4)} (len ${acc.length})` : 'EMPTY')
console.log('P12 exists        :', existsSync(process.env.SBER_P12_PATH))
console.log('CA exists         :', existsSync(process.env.SBER_CA_PATH))
console.log('ACCESS len        :', (process.env.SBER_ACCESS_TOKEN || '').length)
console.log('REFRESH len       :', (process.env.SBER_REFRESH_TOKEN || '').length)

const modPath = 'file://' + join(root, 'out', 'main', 'sber-api', 'index.js').replaceAll('\\', '/')
const { SberApi } = await import(modPath)

const api = new SberApi({ userDataDir: join(root, '.sber-data') })
const stored = await api.store.describe()
console.log('\n[store] сохранённые токены:', JSON.stringify(stored))
const st = await api.oauth.status()
console.log('[oauth] status:', JSON.stringify(st, null, 2))

// Если в хранилище токенов нет — берём из .env
if (!st.hasAccessToken && process.env.SBER_ACCESS_TOKEN) {
  console.log('\n[store] токенов нет — записываю из .env')
  await api.oauth.setTokens({
    accessToken: process.env.SBER_ACCESS_TOKEN,
    refreshToken: process.env.SBER_REFRESH_TOKEN,
    expiresInSeconds: Number(process.env.SBER_TOKEN_EXPIRES_IN) || undefined,
    scope: process.env.SBER_SCOPES
  })
}

try {
  const token = await api.oauth.getValidAccessToken()
  console.log('\n[token] получен рабочий access token, len:', token.length)
} catch (e) {
  console.log('\n[token] ОШИБКА:', e.message, '| code:', e.code)
}

console.log('\n[log] последние строки журнала модуля:')
for (const l of (await api.inspect()).log) console.log('   ', l.level, l.message, JSON.stringify(l.details || {}))
