import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

const text = readFileSync('.env', 'utf8').replace(/^\uFEFF/, '')
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
}

const modPath = 'file://' + join(root, 'out', 'main', 'sber-api', 'index.js').replaceAll('\\', '/')
const { SberApi } = await import(modPath)
const { sberRequest } = await import(modPath)

const api = new SberApi({ userDataDir: join(root, '.sber-data') })
const base = process.env.SBER_PRODUCTION_BASE_URL.replace(/\/+$/, '')
const path = process.env.SBER_PRODUCTION_STATEMENT_TRANSACTION_PATH
const account = process.env.SBER_PRODUCTION_ACCOUNT_NUMBER

const token = await api.oauth.getValidAccessToken()
const tls = {
  p12Path: process.env.SBER_P12_PATH,
  p12Password: process.env.SBER_P12_PASSWORD,
  caPath: process.env.SBER_CA_PATH,
  allowInvalidServerCert: process.env.SBER_ALLOW_INVALID_SERVER_CERT === 'true'
}

function describe(label, res) {
  const json = res.json
  let shape = typeof json
  if (json && typeof json === 'object') {
    shape = Array.isArray(json) ? `array(${json.length})` : `object keys=[${Object.keys(json).join(',')}]`
  }
  console.log(`${label} → HTTP ${res.status} | ${shape}`)
  if (!res.ok) console.log('   body:', (res.text || '').slice(0, 400))
}

for (const date of ['2026-11-19', '2026-11-18', '2026-11-17']) {
  const url = `${base}${path}?accountNumber=${encodeURIComponent(account)}&statementDate=${date}&page=1`
  try {
    const res = await sberRequest(tls, { method: 'GET', url, headers: { Authorization: `Bearer ${token}` }, timeoutMs: 25000 })
    describe(`transactions ${date}`, res)
    if (res.ok && res.json) {
      const s = JSON.stringify(res.json)
      console.log('   payload length:', s.length, '| first 300:', s.slice(0, 300))
    }
  } catch (e) {
    console.log(`transactions ${date} → EXCEPTION:`, e.message, '| code:', e.code)
  }
}

// Проверка summary по счёту за сегодня
const summaryUrl = `${base}${process.env.SBER_PRODUCTION_STATEMENT_ACCOUNT_PATH}?accountNumber=${encodeURIComponent(account)}&statementDate=2026-11-19&page=1`
try {
  const res = await sberRequest(tls, { method: 'GET', url: summaryUrl, headers: { Authorization: `Bearer ${token}` }, timeoutMs: 25000 })
  describe('summary 2026-11-19', res)
  if (res.ok && res.json) console.log('   first 300:', JSON.stringify(res.json).slice(0, 300))
} catch (e) {
  console.log('summary → EXCEPTION:', e.message, '| code:', e.code)
}
