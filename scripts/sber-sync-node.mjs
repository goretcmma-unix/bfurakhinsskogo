// Запуск синхронизации Sber API → Supabase прямо в Node.js (не в терминале CMD).
// Использование: node scripts/sber-sync-node.mjs
// Требует: npm run build (чтобы изготовить out/main/sber-api/index.js)
// Токены должны быть сохранены в .sber-data/sber-secrets/tokens.json
// (нажмите «Авторизовать» в приложении перед первым запуском).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
process.chdir(root)

// --- загрузка .env ---
function loadEnv() {
  const envPath = path.join(root, '.env')
  if (!fs.existsSync(envPath)) {
    console.warn('[sber-sync-node] .env не найден — берём переменные из окружения')
    return
  }
  const text = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '')
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const key = m[1]
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnv()

// --- проверка сборки ---
const outPath = path.join(root, 'out', 'main', 'sber-api', 'index.js')
if (!fs.existsSync(outPath)) {
  console.error('[sber-sync-node] Не найдена сборка out/main/sber-api/index.js')
  console.error('  Выполните: npm run build')
  process.exit(1)
}

const modPath = 'file://' + outPath.replaceAll('\\', '/')
const mod = await import(modPath)
const { SberApi } = mod

const userDataDir = path.join(root, '.sber-data')
if (!fs.existsSync(userDataDir)) {
  console.error('[sber-sync-node] Не найден каталог .sber-data:', userDataDir)
  process.exit(1)
}

const api = new SberApi({ userDataDir })
const intervalMs = api.config.sync.intervalMs ?? 5_000

console.log(JSON.stringify({
  ts: new Date().toISOString(),
  event: 'starting',
  intervalMs,
  environment: api.config.environment,
  statementMode: api.config.sync.statementMode,
  accountMasked: api.config.sync.accountNumber ? `****${api.config.sync.accountNumber.slice(-4)}` : null,
  userDataDir
}))

let inFlight = false
let stopped = false
let tickNo = 0

async function runTick(trigger) {
  if (stopped) return
  if (inFlight) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'skip', trigger, reason: 'in_flight' }))
    return
  }
  inFlight = true
  tickNo += 1
  const n = tickNo
  const t0 = Date.now()
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'start', n, trigger }))
  try {
    const entry = await api.syncNow(trigger)
    const ok = entry.status === 'success' || entry.status === 'partial'
    const line = {
      ts: new Date().toISOString(),
      event: ok ? 'done' : 'failed',
      n,
      trigger,
      status: entry.status,
      from: entry.fromDate,
      to: entry.toDate,
      fetched: entry.fetched,
      inserted: entry.inserted,
      duplicates: entry.duplicates,
      rejected: entry.rejected,
      failedDates: Array.isArray(entry.failedDates) ? entry.failedDates.length : 0,
      errorCode: entry.errorCode || null,
      error: entry.error || null,
      ms: Date.now() - t0
    }
    if (ok) console.log(JSON.stringify(line))
    else console.error(JSON.stringify(line))
  } catch (e) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      event: 'exception',
      n,
      trigger,
      error: e instanceof Error ? e.message : String(e),
      ms: Date.now() - t0
    }))
  } finally {
    inFlight = false
  }
}

// первый прогон при старте
await runTick('startup')

// периодические прогоны
const timer = setInterval(() => {
  void runTick('auto')
}, intervalMs)

// процесс жив до ручной остановки (Ctrl+C)
process.on('SIGINT', () => {
  stopped = true
  clearInterval(timer)
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'stopped', signal: 'SIGINT' }))
  process.exit(0)
})
process.on('SIGTERM', () => {
  stopped = true
  clearInterval(timer)
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'stopped', signal: 'SIGTERM' }))
  process.exit(0)
})
