import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

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

// Refresh-токены одноразовые: если локальный запуск и GitHub обновят одну и ту
// же пару одновременно, второй получит invalid_grant. Два предохранителя:
//  1) локальный lock — не даём двум локальным процессам работать одновременно;
//  2) при REAUTH_REQUIRED берём из origin/master только более СВЕЖУЮ пару
//     (по savedAt), чтобы не затереть только что импортированные токены.
const TOKEN_FILE = '.sber-data/sber-secrets/tokens.json'
const LOCK_FILE = path.join(root, '.sber-data', 'sber-sync.lock')

function acquireLocalLock() {
  if (process.env.GITHUB_ACTIONS === 'true') return true
  try {
    const fd = fs.openSync(LOCK_FILE, 'wx')
    fs.writeSync(fd, String(process.pid))
    fs.closeSync(fd)
    return true
  } catch (e) {
    if (e?.code !== 'EEXIST') throw e
    const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs
    if (age < 5 * 60 * 1000) return false
    fs.unlinkSync(LOCK_FILE)
    return acquireLocalLock()
  }
}

function releaseLocalLock() {
  if (process.env.GITHUB_ACTIONS === 'true') return
  try { fs.unlinkSync(LOCK_FILE) } catch {}
}
process.on('exit', releaseLocalLock)

async function savedAtOfTokenFile(buf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sber-repo-tokens-'))
  try {
    const target = path.join(dir, 'sber-secrets', 'tokens.json')
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
    fs.writeFileSync(target, buf, { mode: 0o600 })
    const probe = new SberApi({ userDataDir: dir })
    const pair = await probe.store.loadTokens()
    return Number(pair?.savedAt ?? 0)
  } catch (e) {
    console.warn(JSON.stringify({
      ts: new Date().toISOString(),
      event: 'repo_token_decode_failed',
      reason: e instanceof Error ? e.message : String(e)
    }))
    return 0
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function adoptNewerTokensFromRepo() {
  if (process.env.GITHUB_ACTIONS === 'true') return false
  try {
    execFileSync('git', ['fetch', 'origin', 'master', '--quiet'], { stdio: 'ignore' })
    const repoBuf = execFileSync(
      'git', ['show', `origin/master:${TOKEN_FILE}`],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    const localPath = path.join(root, TOKEN_FILE)
    const localBuf = fs.existsSync(localPath) ? fs.readFileSync(localPath) : null
    if (localBuf && localBuf.equals(repoBuf)) return false

    const repoSavedAt = await savedAtOfTokenFile(repoBuf)
    const localSavedAt = Number(api.store.loadTokens()?.savedAt ?? 0)
    if (!repoSavedAt || repoSavedAt <= localSavedAt) {
      console.log(JSON.stringify({
        ts: new Date().toISOString(),
        event: 'local_tokens_are_newer',
        localSavedAt,
        repoSavedAt
      }))
      return false
    }

    fs.writeFileSync(localPath, repoBuf, { mode: 0o600 })
    // Store кэширует пару в памяти — сбрасываем кэш, иначе обновлённый файл
    // не будет прочитан и повторный sync упадёт всё с той же старой парой.
    api.store.memory = null
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      event: 'tokens_adopted_from_repo',
      repoSavedAt,
      localSavedAt
    }))
    return true
  } catch (e) {
    console.warn(JSON.stringify({
      ts: new Date().toISOString(),
      event: 'tokens_adopt_failed',
      reason: e instanceof Error ? e.message : String(e)
    }))
    return false
  }
}

async function runTick(trigger) {
  if (stopped) return
  if (inFlight) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'skip', trigger, reason: 'in_flight' }))
    return
  }
  if (!acquireLocalLock()) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'skip', trigger, reason: 'another_local_sync_running' }))
    return
  }
  inFlight = true
  tickNo += 1
  const n = tickNo
  const t0 = Date.now()
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'start', n, trigger }))
  try {
    let entry
    for (let attempt = 1; ; attempt += 1) {
      entry = await api.syncNow(trigger)
      if (entry?.errorCode !== 'REAUTH_REQUIRED') break
      if (process.env.GITHUB_ACTIONS === 'true' || attempt >= 3) break
      // GitHub мог успеть обновить и закоммитить пару, пока локальный запрос
      // получил invalid_grant. Подождём и возьмём более свежую пару из репозитория.
      const adopted = await adoptNewerTokensFromRepo()
      if (!adopted) {
        await new Promise(resolve => setTimeout(resolve, 5000 * attempt))
        continue
      }
      console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'retry_after_token_adopt', n, attempt }))
    }
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
    else {
      console.error(JSON.stringify(line))
      // GitHub must not report a green run when the sync actually failed.
      process.exitCode = 1
    }
  } catch (e) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      event: 'exception',
      n,
      trigger,
      error: e instanceof Error ? e.message : String(e),
      ms: Date.now() - t0
    }))
    process.exitCode = 1
  } finally {
    inFlight = false
    releaseLocalLock()
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

// GitHub Actions always wants a single tick: it is scheduled externally and
// must exit after fetching the latest transactions. Locally, without --once,
// the same script can still run as a continuous daemon.
const onceMode = process.argv.includes('--once') || process.env.GITHUB_ACTIONS === 'true'

// ... (existing code)

await runTick('startup')
if (onceMode) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'once_done' }))
  process.exit()
}
timer = setInterval(() => {
  void runTick('auto')
}, intervalMs)

// keep process alive
setInterval(() => {}, 1 << 30)
