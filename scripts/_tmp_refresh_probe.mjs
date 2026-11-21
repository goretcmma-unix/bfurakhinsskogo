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
const { sberRequest } = await import(modPath)

const tls = {
  p12Path: process.env.SBER_P12_PATH,
  p12Password: process.env.SBER_P12_PASSWORD,
  caPath: process.env.SBER_CA_PATH,
  allowInvalidServerCert: process.env.SBER_ALLOW_INVALID_SERVER_CERT === 'true'
}

const tokenUrl = process.env.SBER_PRODUCTION_TOKEN_URL
const rt = process.env.SBER_REFRESH_TOKEN
const cid = process.env.SBER_CLIENT_ID
const csec = process.env.SBER_CLIENT_SECRET
console.log('tokenUrl:', tokenUrl)
console.log('refresh len:', rt.length, '| client_id len:', cid.length, '| client_secret len:', csec.length)

function summarize(label, res) {
  const j = res.json || {}
  const keys = j && typeof j === 'object' ? Object.keys(j).join(',') : typeof j
  console.log(`\n${label} → HTTP ${res.status} keys=[${keys}]`)
  if (!res.ok) {
    console.log('   error:', j.error ?? j.cause ?? '-', '| description:', String(j.error_description ?? j.message ?? res.text).slice(0, 240))
  } else {
    console.log('   access_token len:', String(j.access_token ?? '').length,
      '| refresh_token len:', String(j.refresh_token ?? '').length,
      '| expires_in:', j.expires_in, '| refresh_expires_in:', j.refresh_expires_in,
      '| scope len:', String(j.scope ?? '').length)
  }
  return res
}

async function post(label, fields, asJson) {
  try {
    const res = asJson
      ? await sberRequest(tls, { method: 'POST', url: tokenUrl, body: JSON.stringify(fields), timeoutMs: 25000 })
      : await sberRequest(tls, {
        method: 'POST', url: tokenUrl, timeoutMs: 25000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString()
      })
    return summarize(label, res)
  } catch (e) {
    console.log(`\n${label} → EXCEPTION: ${e.message} | code: ${e.code}`)
    return null
  }
}

// 1) форма: grant_type + refresh_token
await post('form: minimal', { grant_type: 'refresh_token', refresh_token: rt }, false)
// 2) форма + client_id
await post('form: +client_id', { grant_type: 'refresh_token', refresh_token: rt, client_id: cid }, false)
// 3) форма + client_id + client_secret
await post('form: +client_id +secret', { grant_type: 'refresh_token', refresh_token: rt, client_id: cid, client_secret: csec }, false)
// 4) JSON
await post('json: +client_id +secret', { grant_type: 'refresh_token', refresh_token: rt, client_id: cid, client_secret: csec }, true)
// 5) client_credentials (проверка, живёт ли сам mTLS-канал авторизации)
await post('form: client_credentials', { grant_type: 'client_credentials', client_id: cid, client_secret: csec }, false)
