#!/usr/bin/env node
/**
 * Проверка подключения к Sandbox Sber API — без запуска приложения.
 *
 * Запуск:  npm run sber:check
 *
 * Что делает:
 *  1) читает .env (секреты не печатает);
 *  2) проверяет, какие обязательные параметры заданы;
 *  3) проверяет mTLS-сертификат и токены;
 *  4) если задан SBER_SANDBOX_BASE_URL — делает безопасный GET-запрос в Sandbox.
 *
 * Результат печатается списком шагов: [OK] / [НЕТ] с пояснением.
 * Реальных банковских операций и Production-запросов не выполняется.
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// ---- 1. Чтение .env без внешних зависимостей -------------------------------
function loadEnv() {
  const file = join(root, '.env')
  if (!existsSync(file)) {
    console.log('[i] Файл .env не найден — создайте его по образцу .env.example')
    return
  }
  const text = readFileSync(file, 'utf8')
  let count = 0
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
    count++
  }
  console.log(`[i] Загружено параметров из .env: ${count}`)
}

loadEnv()

// ---- 2. Импорт скомпилированного модуля main-процесса ----------------------
const require = createRequire(import.meta.url)
const mainBundle = join(root, 'out', 'main', 'index.js')

if (!existsSync(mainBundle)) {
  console.error('[ОШИБКА] Не найдена сборка main-процесса: out/main/index.js')
  console.error('          Сначала выполните: npm run build')
  process.exit(1)
}

// Модуль sber-api компилируется в тот же бандл, поэтому импортируем его напрямую
// из исходников через tsx-подобный путь: electron-vite собирает единственный вход.
// Простейший и надёжный способ — отдельная сборка модуля в out/sber-api.
const sberModulePath = join(root, 'out', 'main', 'sber-api', 'index.js')
if (!existsSync(sberModulePath)) {
  console.error('[ОШИБКА] Не найдена сборка модуля Sber: out/sber-api/index.js')
  console.error('          Выполните: npm run build')
  process.exit(1)
}

const { SberApi } = require(sberModulePath)

// ---- 3. Диагностика --------------------------------------------------------
const api = new SberApi({ userDataDir: join(root, '.sber-data') })

const inspect = await api.inspect()

console.log('')
console.log('=== КОНФИГУРАЦИЯ ===')
console.log(`Окружение:        ${inspect.environment}`)
console.log(`Scopes:           ${inspect.scopes.join(', ')}`)
for (const [key, value] of Object.entries(inspect.endpoints)) {
  const mark = value === 'configured' ? 'OK' : 'не задан'
  console.log(`${key.padEnd(20)} ${mark}`)
}
if (inspect.config.missing.length) {
  console.log(`Не заданы:        ${inspect.config.missing.join(', ')}`)
}
for (const warn of inspect.config.warnings) console.log(`! ${warn}`)

const diag = await api.diagnose()

console.log('')
console.log('=== ПРОВЕРКА SANDBOX ===')
for (const step of diag.steps) {
  console.log(`${step.ok ? '[OK] ' : '[НЕТ]'} ${step.name.padEnd(22)} ${step.detail}`)
}
console.log('')
console.log(diag.ok ? 'Результат: подключение к Sandbox готово.' : 'Результат: требуется донастроить (см. шаги выше).')

if (inspect.authorizeAvailable) {
  console.log('\nДля получения кода авторизации доступна ссылка (откройте в браузере):')
  const a = api.oauth.buildAuthorizeUrl()
  if (a) console.log(a.url)
}

console.log('\nПоследние записи журнала (без секретов):')
for (const entry of inspect.log.slice(-10)) {
  console.log(`  ${entry.ts} [${entry.level}] ${entry.message}`)
}

process.exit(diag.ok ? 0 : 2)
