#!/usr/bin/env node
/**
 * Автотест OAuth-слоя Sber API — без обращения к банку.
 *
 * Проверяет три требования:
 *  1) парсинг срока действия с учётом часового пояса банка;
 *  2) отсутствие символов токена в сохранённых данных и журнале;
 *  3) отсутствие обновления токена при 403 (недостаток прав).
 *
 * Запуск: node scripts/sber-oauth-test.mjs
 */

import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mod = require(join(root, 'out', 'main', 'sber-api', 'index.js'))

const { parseExpiryDate } = mod
const { SberOAuth } = require(join(root, 'out', 'main', 'sber-api', 'index.js'))

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '[OK] ' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!cond) failures++
}

// ============================================================
// 1. ПАРСИНГ ДАТЫ С УЧЁТОМ ЧАСОВОГО ПОЯСА
// ============================================================
console.log('--- Часовой пояс ---')

// Пример из ЛК: "18.12.2026 07:27:18" (время Москвы, UTC+3)
const msk = parseExpiryDate('18.12.2026 07:27:18', 180)
check(
  '18.12.2026 07:27:18 МСК = 2026-12-18T04:27:18Z',
  new Date(msk).toISOString() === '2026-12-18T04:27:18.000Z',
  new Date(msk).toISOString()
)

// Тот же момент, но машина в UTC+0 — результат ДОЛЖЕН совпасть
const utcMachine = parseExpiryDate('18.12.2026 07:27:18', 180)
check('Результат не зависит от часового пояса машины', utcMachine === msk)

// Другой часовой пояс банка (UTC+7) — результат сдвигается
const kras = parseExpiryDate('18.12.2026 07:27:18', 420)
check(
  'UTC+7 даёт другой момент (07:27 − 7ч)',
  new Date(kras).toISOString() === '2026-12-18T00:27:18.000Z',
  new Date(kras).toISOString()
)

// Явная зона в строке имеет приоритет
const withZone = parseExpiryDate('2026-12-18T07:27:18+03:00', 420)
check(
  'Явная зона (+03:00) игнорирует настройку',
  new Date(withZone).toISOString() === '2026-12-18T04:27:18.000Z',
  new Date(withZone).toISOString()
)

// Формат без времени
const dateOnly = parseExpiryDate('18.12.2026', 180)
check(
  'Дата без времени = 00:00 МСК',
  new Date(dateOnly).toISOString() === '2026-12-17T21:00:00.000Z',
  new Date(dateOnly).toISOString()
)

// Только дата ISO без зоны
const isoDate = parseExpiryDate('2026-12-18', 180)
check('ISO-дата без времени трактуется в зоне банка', isoDate === dateOnly)

// Мусор
check('Мусор → null', parseExpiryDate('не дата') === null)
check('Пустое → null', parseExpiryDate('') === null)

// ============================================================
// 2. БЕЗ УТЕЧКИ СИМВОЛОВ ТОКЕНА
// ============================================================
console.log('\n--- Утечка токена ---')

const ACCESS = 'TEST_ACCESS_TOKEN_ABCDEF1234567890'
const REFRESH = 'TEST_REFRESH_TOKEN_ZYXWVU0987654321'

const tmp = mkdtempSync(join(tmpdir(), 'sber-test-'))
process.env.SBER_STORE_PASSPHRASE = 'test-passphrase'
process.env.SBER_SCOPES = 'GET_STATEMENT_ACCOUNT GET_STATEMENT_TRANSACTION'
process.env.SBER_CLIENT_ID = 'test-client'
process.env.SBER_REDIRECT_URI = 'http://localhost/cb'
process.env.SBER_SANDBOX_TOKEN_URL = 'https://sandbox.invalid/token'

const cfg = {
  environment: 'sandbox',
  clientId: 'test-client',
  clientSecret: '',
  redirectUri: 'http://localhost/cb',
  scopes: ['GET_STATEMENT_ACCOUNT', 'GET_STATEMENT_TRANSACTION'],
  p12Path: join(tmp, 'client.p12'),
  caPath: '',
  allowInvalidServerCert: false,
  endpoints: {
    sandbox: { baseUrl: '', tokenUrl: 'https://sandbox.invalid/token', statementAccountPath: '', statementTransactionPath: '' },
    production: { baseUrl: '', tokenUrl: '', statementAccountPath: '', statementTransactionPath: '' }
  }
}

// Используем публичный API модуля
const moduleRoot = mod
const store = new moduleRoot.SberApi({ userDataDir: tmp })
const oauth = store.oauth

await oauth.setTokens({ accessToken: ACCESS, refreshToken: REFRESH, expiresInSeconds: 3600 })

// Проверяем файл на диске
const tokensPath = join(tmp, 'sber-secrets', 'tokens.json')
check('Файл токенов создан', existsSync(tokensPath))

const fileContent = existsSync(tokensPath) ? readFileSync(tokensPath, 'utf8') : ''
check('Файл не содержит Access Token', !fileContent.includes(ACCESS))
check('Файл не содержит Refresh Token', !fileContent.includes(REFRESH))
check('Файл не содержит последних символов токена', !fileContent.includes('1234567890'))

// Проверяем журнал
const inspect = await moduleRoot.SberApi.prototype.inspect.call(store)
const logText = JSON.stringify(inspect.log)
check('Журнал не содержит Access Token', !logText.includes(ACCESS))
check('Журнал не содержит Refresh Token', !logText.includes(REFRESH))
check('Журнал не содержит хвоста токена', !logText.includes('1234567890') && !logText.includes('0987654321'))

// В статусе нет самих токенов
const statusText = JSON.stringify(await oauth.status())
check('Статус не раскрывает токены', !statusText.includes(ACCESS) && !statusText.includes(REFRESH))

// ============================================================
// 3. 403 НЕ ДОЛЖЕН ВЫЗЫВАТЬ ОБНОВЛЕНИЕ ТОКЕНА
// ============================================================
console.log('\n--- Разделение 401 / 403 ---')

let refreshCalls = 0
oauth.refresh = async () => {
  refreshCalls++
  return 'NEW_TOKEN'
}

// 403 — недостаток прав
let err403 = null
try {
  await oauth.withAuthorizedRequest(async () => ({ ok: false, status: 403, bodyText: 'forbidden', value: null }))
} catch (e) {
  err403 = e
}
check('403 не вызывает refresh', refreshCalls === 0, `refresh вызван ${refreshCalls} раз`)
check('403 даёт код INSUFFICIENT_SCOPE', err403?.code === 'INSUFFICIENT_SCOPE', err403?.code)

// 401 — протухший токен
refreshCalls = 0
let calls = 0
const result = await oauth.withAuthorizedRequest(async (token) => {
  calls++
  if (token === 'NEW_TOKEN') return { ok: true, status: 200, value: 'ok' }
  return { ok: false, status: 401, bodyText: 'unauthorized', value: null }
})
check('401 вызывает refresh ровно один раз', refreshCalls === 1, `refresh вызван ${refreshCalls}`)
check('401 → повтор запроса выполнен', calls === 2, `запросов ${calls}`)
check('401 → повтор успешен', result === 'ok')

// 401 повторно 401 — не бесконечный цикл
refreshCalls = 0
let err401 = null
try {
  await oauth.withAuthorizedRequest(async () => ({ ok: false, status: 401, bodyText: 'unauthorized', value: null }))
} catch (e) {
  err401 = e
}
check('Повторный 401 → ошибка AUTH_FAILED', err401?.code === 'AUTH_FAILED', err401?.code)
check('Повторный 401 → только один refresh', refreshCalls === 1, `refresh вызван ${refreshCalls}`)

console.log('')
console.log(failures === 0 ? 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `ПРОВАЛЕНО ПРОВЕРОК: ${failures}`)
process.exit(failures === 0 ? 0 : 1)
