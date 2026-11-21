import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
process.chdir(root)

function loadEnv() {
  const envPath = path.join(root, '.env')
  if (!fs.existsSync(envPath)) return
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

const modPath = 'file://' + path.join(root, 'out', 'main', 'sber-api', 'index.js').replaceAll('\\', '/')
if (!fs.existsSync(path.join(root, 'out', 'main', 'sber-api', 'index.js'))) {
  console.error('[sber-auto-sync] Не найдена сборка out/main/sber-api/index.js. Выполните: npm run build')
  process.exit(1)
}

const mod = await import(modPath)
const { SberApi } = mod

const userDataDir = path.join(root, '.sber-data')
if (!fs.existsSync(userDataDir)) {
  console.error('[sber-auto-sync] Не найден .sber-data:', userDataDir)
  process.exit(1)
}

const api = new SberApi({ userDataDir })
const intervalMs = api.config.sync.intervalMs ?? 5000

if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
  console.error('[sber-auto-sync] Автосинхронизация отключена (интервал = 0)')
  process.exit(1)
}

let inFlight = false
let stopped = false
let timer = null
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

function shutdown(signal) {
  if (stopped) return
  stopped = true
  if (timer) clearInterval(timer)
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'stopped', signal, inFlight }))
  const wait = inFlight ? 30000 : 100
  setTimeout(() => process.exit(0), wait).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

console.log(JSON.stringify({
  ts: new Date().toISOString(),
  event: 'starting',
  intervalMs,
  environment: api.config.environment,
  statementMode: api.config.sync.statementMode,
  accountMasked: api.config.sync.accountNumber ? `****${api.config.sync.accountNumber.slice(-4)}` : null,
  userDataDir
}))

await runTick('startup')
timer = setInterval(() => {
  void runTick('auto')
}, intervalMs)

// keep process alive
setInterval(() => {}, 1 << 30)
