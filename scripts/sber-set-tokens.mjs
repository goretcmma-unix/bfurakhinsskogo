#!/usr/bin/env node
/**
 * Переносит актуальную пару токенов из .env в защищённое хранилище .sber-data.
 *
 *   npm run sber:set-tokens
 *
 * В .env должны быть заданы полные (не замаскированные) значения:
 *   SBER_ACCESS_TOKEN=...
 *   SBER_REFRESH_TOKEN=...
 *
 * Секреты в консоль не выводятся.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
const envPath = path.join(root, '.env')
const text = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '')
const env = {}
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
  if (!m) continue
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  env[m[1]] = v
}
for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v

const access = (env.SBER_ACCESS_TOKEN || '').trim()
const refresh = (env.SBER_REFRESH_TOKEN || '').trim()
if (!access || !refresh) {
  console.error('[sber:set-tokens] В .env не заданы SBER_ACCESS_TOKEN и SBER_REFRESH_TOKEN')
  process.exit(1)
}
if (/\*/.test(access) || /\*/.test(refresh)) {
  console.error('[sber:set-tokens] Похоже, вставлены замаскированные токены из СберБизнеса — нужны полные значения')
  process.exit(1)
}

const modPath = 'file://' + path.join(root, 'out/main/sber-api/index.js').replaceAll('\\', '/')
const { SberApi, parseExpiryDate } = await import(modPath)
const api = new SberApi({ userDataDir: path.join(root, '.sber-data') })

// Access и refresh истекают в разные даты. Важно сохранить ОБЕ, иначе
// просроченный access будет считаться «бессрочным», а рабочий refresh — неизвестным.
function accessExpiry(raw) {
  const value = (raw || '').trim()
  if (!value) return {}
  if (/^\d+$/.test(value)) return { expiresInSeconds: Number(value) }
  return { expiresAt: value }
}

function refreshTtlSeconds(raw) {
  const value = (raw || '').trim()
  if (!value) return undefined
  if (/^\d+$/.test(value)) return Number(value)
  const absolute = parseExpiryDate(value)
  return absolute && absolute > Date.now() ? Math.floor((absolute - Date.now()) / 1000) : undefined
}

const accessRaw = env.SBER_TOKEN_EXPIRES_IN || env.SBER_ACCESS_TOKEN_EXPIRES_AT || ''
const refreshRaw =
  env.SBER_REFRESH_TOKEN_EXPIRES_IN ||
  env.SBER_REFRESH_TOKEN_EXPIRES_AT ||
  env.SBER_REFRESH_EXPIRES_AT ||
  ''

const status = await api.oauth.setTokens({
  accessToken: access,
  refreshToken: refresh,
  ...accessExpiry(accessRaw),
  refreshExpiresInSeconds: refreshTtlSeconds(refreshRaw),
  scope: env.SBER_SCOPES || env.SBER_TOKEN_SCOPE
})

console.log(JSON.stringify({
  event: 'tokens_imported',
  hasAccess: status.hasAccessToken,
  hasRefresh: status.hasRefreshToken,
  accessExpiresAt: status.accessExpiresAt || null,
  refreshExpiresAt: status.refreshExpiresAt || null
}, null, 2))
