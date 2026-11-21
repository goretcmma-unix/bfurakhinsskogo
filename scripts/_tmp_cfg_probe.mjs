import { readFileSync } from 'node:fs'

const text = readFileSync('.env', 'utf8').replace(/^\uFEFF/, '')
const env = {}
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}

for (const k of ['SBER_AUTHORIZE_URL', 'SBER_REDIRECT_URI', 'SBER_CLIENT_ID', 'SBER_TOKEN_GRANT_TYPE', 'SBER_STATEMENT_USE_PERIOD', 'SBER_TOKEN_EXPIRES_IN']) {
  console.log(k.padEnd(28), env[k] === undefined ? 'NOT SET' : JSON.stringify(env[k]))
}

console.log('\nscopes (первые 120):', (env.SBER_SCOPES || '').slice(0, 120))
console.log('scopes содержит GET_STATEMENT_TRANSACTION:', (env.SBER_SCOPES || '').includes('GET_STATEMENT_TRANSACTION'))
