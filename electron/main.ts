import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { SberApi, sberLog } from './sber-api'
import { loadSberConfig, checkSberConfig } from './sber-api/config'

const isElectronRuntime = Boolean(app) && typeof app.isPackaged === 'boolean'

if (!isElectronRuntime) {
  console.error('[FATAL] This application must be started with Electron, not plain Node.js.')
  process.exit(1)
}

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production'

const DEBUG_FLAGS = ['--remote-debugging-port', '--remote-debugging-pipe', '--inspect', '--inspect-brk']

function hasDebugFlag(): boolean {
  const args = [...process.argv, ...process.execArgv]
  return args.some((arg) => DEBUG_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`)))
}

// A packaged build must never run with an attached debugger.
if (!isDev && hasDebugFlag()) {
  console.error('[SECURITY] Debug flags detected in a production build. Refusing to start.')
  app.exit(1)
}

// Sandbox every renderer process and never use the GPU.
app.enableSandbox()
app.disableHardwareAcceleration()

const APP_ORIGIN_FILE = pathToFileURL(join(__dirname, '../renderer/index.html')).href

const APP_ICON = app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : join(__dirname, '../../resources/icon.png')

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
}

function isLocalRendererUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return isLocalHost(u.hostname) && (u.protocol === 'http:' || u.protocol === 'https:')
  } catch {
    return false
  }
}

function isAllowedAppUrl(url: string): boolean {
  try {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl) {
      if (!isLocalRendererUrl(devUrl)) return false
      return new URL(url).origin === new URL(devUrl).origin
    }
    return url === APP_ORIGIN_FILE || url.startsWith(`${APP_ORIGIN_FILE}#`) || url.startsWith(`${APP_ORIGIN_FILE}?`)
  } catch {
    return false
  }
}

const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' http: https:; style-src 'self' 'unsafe-inline' http: https:; img-src 'self' data: blob: http: https:; font-src 'self' data: http: https:; connect-src 'self' ws: wss: http: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://ybgxfewbhjvtgdklzihr.supabase.co wss:; media-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

function setupSessionSecurity(): void {
  const sess = session.defaultSession

  // Deny every permission prompt (camera, microphone, geolocation, notifications, ...).
  sess.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  sess.setPermissionCheckHandler(() => false)

  sess.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders }
    responseHeaders['Content-Security-Policy'] = [isDev ? DEV_CSP : PROD_CSP]
    responseHeaders['X-Content-Type-Options'] = ['nosniff']
    responseHeaders['X-Frame-Options'] = ['DENY']
    responseHeaders['Referrer-Policy'] = ['no-referrer']
    responseHeaders['Permissions-Policy'] = ['geolocation=(), microphone=(), camera=()']
    callback({ responseHeaders })
  })

  sess.webRequest.onBeforeRequest((details, callback) => {
    try {
      const { protocol, hostname } = new URL(details.url)
      if (['file:', 'blob:', 'data:', 'devtools:'].includes(protocol)) {
        callback({})
        return
      }
      const isDevServerRequest =
        isDev && ['http:', 'https:', 'ws:', 'wss:'].includes(protocol) && isLocalHost(hostname)
      const isSupabaseRequest = hostname === 'ybgxfewbhjvtgdklzihr.supabase.co'
      callback({ cancel: !(isDevServerRequest || isSupabaseRequest) })
    } catch {
      callback({ cancel: true })
    }
  })
}

let mainWindow: BrowserWindow | null = null

const rateBuckets = new Map<string, number[]>()

function allowRequest(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const bucket = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (bucket.length >= limit) {
    rateBuckets.set(key, bucket)
    return false
  }
  bucket.push(now)
  rateBuckets.set(key, bucket)
  return true
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!frame || frame.parent !== null) return false
  if (!mainWindow || event.sender !== mainWindow.webContents) return false
  return frame.url === event.sender.getURL() && isAllowedAppUrl(frame.url)
}

function hardenWebContents(contents: Electron.WebContents): void {
  contents.on('will-attach-webview', (event) => event.preventDefault())

  contents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url)
      if (protocol === 'https:' || protocol === 'mailto:') shell.openExternal(url)
    } catch {
      // ignore malformed URLs
    }
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (!isAllowedAppUrl(url)) event.preventDefault()
  })

  contents.on('before-input-event', (event, input) => {
    if (isDev) return
    const key = input.key.toLowerCase()
    const ctrl = input.control || input.meta
    const isDevToolsShortcut = key === 'f12' || (ctrl && input.shift && ['i', 'j', 'c'].includes(key))
    const isReloadShortcut = key === 'f5' || (ctrl && key === 'r')
    if (isDevToolsShortcut || isReloadShortcut) event.preventDefault()
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#0B0D0D',
    show: false,
    autoHideMenuBar: true,
    title: 'Charity Finance',
    icon: APP_ICON,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      devTools: isDev,
      spellcheck: false,
      webviewTag: false,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      safeDialogs: true
    }
  })

  mainWindow = win

  if (!isDev) {
    win.setMenu(null)
    win.webContents.on('devtools-opened', () => win.webContents.closeDevTools())
  }

  win.on('ready-to-show', () => win.show())

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[LOAD ERROR]', errorCode, errorDescription, validatedURL)
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[RENDER GONE]', details.reason)
  })

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    if (!isLocalRendererUrl(process.env.ELECTRON_RENDERER_URL)) {
      console.error('[SECURITY] Refusing to load non-local renderer URL')
      win.loadFile(join(__dirname, '../renderer/index.html'))
    } else {
      win.loadURL(process.env.ELECTRON_RENDERER_URL)
    }
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function isSafeDefaultPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\0-\x1f]/.test(value)
}

let sberApi: SberApi | null = null

/**
 * Фоновая автосинхронизация Sber API.
 *
 * Работает автоматически: сразу после старта приложения и далее по интервалу
 * SBER_AUTO_SYNC_MINUTES (по умолчанию 30 минут, 0 — выключить).
 * Каждый прогон добирает все пропущенные дни от курсора до сегодняшнего дня
 * включительно, обновляя токен по refresh token до истечения его срока.
 * Дедупликация — в приложении и уникальным индексом БД (fund_id, bank_transaction_id).
 */
let sberAutoSyncTimer: NodeJS.Timeout | null = null
let sberAutoSyncKickoff: NodeJS.Timeout | null = null

function getSberAccountNumber(): string {
  return sberApi?.config.sync.accountNumber ?? ''
}

/** Сообщить renderer о завершении прогона — UI и данные обновляются сразу. */
function broadcastSyncUpdate(entry: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    mainWindow.webContents.send('sber:sync-updated', entry)
  } catch {
    /* окно могло закрыться между проверкой и отправкой */
  }
}

function startSberAutoSync(): void {
  const intervalMs = sberApi?.config.sync.intervalMs ?? 5_000
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    sberLog.info('Автосинхронизация Sber отключена (интервал = 0)')
    return
  }
  if (sberAutoSyncTimer) clearInterval(sberAutoSyncTimer)
  if (sberAutoSyncKickoff) clearTimeout(sberAutoSyncKickoff)

  let tickInFlight = false
  let tickCount = 0

  const runOnce = async (trigger: 'startup' | 'auto') => {
    if (!sberApi) return
    if (tickInFlight) {
      sberLog.info('Автосинк Sber: тик пропущен — предыдущий прогон ещё выполняется', { trigger })
      return
    }
    tickInFlight = true
    tickCount += 1
    const tickNo = tickCount
    sberLog.info('Автосинк Sber: запуск прогона', { trigger, tick: tickNo, intervalMs })
    try {
      const entry = await sberApi.syncNow(trigger)
      const failed = (entry.status === 'failed') || ((entry as any).error)
      if (failed) {
        sberLog.warn('Автосинк Sber: прогон завершился с ошибкой (будет повтор при следующем тике)', {
          trigger,
          tick: tickNo,
          status: entry.status,
          errorCode: (entry as any).errorCode ?? null,
          error: (entry as any).error ?? null,
          from: entry.fromDate,
          to: entry.toDate
        })
      } else {
        sberLog.info('Автосинк Sber: прогон завершён успешно', {
          trigger,
          tick: tickNo,
          status: entry.status,
          inserted: entry.inserted,
          fetched: entry.fetched,
          duplicates: entry.duplicates,
          failedDates: Array.isArray((entry as any).failedDates) ? (entry as any).failedDates.length : 0,
          from: entry.fromDate,
          to: entry.toDate
        })
      }
    } catch (e) {
      sberLog.error('Автосинк Sber: исключение при прогоне (будет повтор при следующем тике)', {
        trigger,
        tick: tickNo,
        reason: e instanceof Error ? e.message : 'unknown'
      })
    } finally {
      tickInFlight = false
    }
  }

  // Первый прогон — через 3 секунды после старта (после инициализации окна).
  sberAutoSyncKickoff = setTimeout(() => void runOnce('startup'), 3_000)
  // Периодический прогон: каждые intervalMs (по умолчанию 5s, в пределах лимита 5 TPS Sber API
  // для /statement/* при последовательных запросах; параллельные прогоны не допускаются).
  sberAutoSyncTimer = setInterval(() => void runOnce('auto'), intervalMs)

  sberLog.info('Автосинхронизация Sber включена', {
    intervalMs,
    intervalMinutes: sberApi?.config.sync.intervalMinutes,
    environment: sberApi?.config.environment,
    statementMode: sberApi?.config.sync.statementMode,
    account: sberApi?.config.sync.accountNumber ? `****${sberApi.config.sync.accountNumber.slice(-4)}` : 'не задан'
  })
}

/**
 * IPC для Sber API. Renderer может только: посмотреть состояние, задать токены
 * и запустить диагностику. Произвольный URL или токен наружу никогда не отдаётся.
 */
function setupSberIpc(): void {
  sberApi = new SberApi({
    userDataDir: app.getPath('userData'),
    onSyncUpdate: (entry) => broadcastSyncUpdate(entry)
  })

  /** Ручной запуск синхронизации из UI. */
  ipcMain.handle('sber:sync-now', async (event) => {
    if (!sberApi) return { ok: false, error: 'Sber API не инициализирован' }
    if (!isTrustedSender(event)) return { ok: false, error: 'untrusted sender' }
    if (!allowRequest(`sber-sync:${event.sender.id}`, 6, 60_000)) {
      return { ok: false, error: 'Слишком частые запуски, подождите минуту.' }
    }
    try {
      const entry = await sberApi.syncNow('manual')
      return { ok: entry.status === 'success' || entry.status === 'partial', entry }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Неизвестная ошибка' }
    }
  })

  /** Состояние автосинхронизации: курсор, последний прогон, токен, интервал. */
  ipcMain.handle('sber:sync-status', async (event) => {
    if (!sberApi) return null
    if (!isTrustedSender(event)) return null
    if (!allowRequest(`sber-status:${event.sender.id}`, 30, 10_000)) return null
    try {
      return await sberApi.syncStatus()
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Неизвестная ошибка' }
    }
  })

  /** Журнал прогонов синхронизации. */
  ipcMain.handle('sber:sync-journal', async (event, limit: unknown) => {
    if (!sberApi) return []
    if (!isTrustedSender(event)) return []
    if (!allowRequest(`sber-journal:${event.sender.id}`, 30, 10_000)) return []
    const size = typeof limit === 'number' && limit > 0 && limit <= 200 ? Math.trunc(limit) : 30
    try {
      return await sberApi.syncJournal(size)
    } catch {
      return []
    }
  })

  /** Полная авторизация в СберБизнес: открывает браузер и ловит redirect локально. */
  ipcMain.handle('sber:authorize', async (event) => {
    if (!sberApi) return { ok: false, error: 'Sber API не инициализирован' }
    if (!isTrustedSender(event)) return { ok: false, error: 'untrusted sender' }
    if (!allowRequest(`sber-auth:${event.sender.id}`, 3, 300_000)) {
      return { ok: false, error: 'Авторизация уже запрошена, завершите вход в браузере.' }
    }
    try {
      return await authorizeSberFlow()
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Неизвестная ошибка' }
    }
  })

  ipcMain.handle('sber:inspect', async (event) => {
    if (!isTrustedSender(event)) return null
    if (!allowRequest(`sber-inspect:${event.sender.id}`, 10, 10_000)) return null
    return sberApi!.inspect()
  })

  // Приём токенов (sandbox/production). В журнал попадают только флаги, не значения.
  ipcMain.handle('sber:setTokens', async (event, payload: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'untrusted sender' }
    if (!allowRequest(`sber-tokens:${event.sender.id}`, 5, 60_000)) {
      return { ok: false, error: 'Слишком много попыток, повторите через минуту.' }
    }
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'Некорректные данные' }

    const input = payload as Record<string, unknown>
    const accessToken = typeof input.accessToken === 'string' ? input.accessToken.trim() : ''
    const refreshToken = typeof input.refreshToken === 'string' ? input.refreshToken.trim() : ''
    const expiresInSeconds = typeof input.expiresInSeconds === 'number' ? input.expiresInSeconds : undefined
    const scope = typeof input.scope === 'string' ? input.scope : undefined

    if (!accessToken) return { ok: false, error: 'Access token не передан' }
    if (accessToken.length > 8192 || refreshToken.length > 8192) {
      return { ok: false, error: 'Слишком длинное значение токена' }
    }

    try {
      const status = await sberApi!.oauth.setTokens({ accessToken, refreshToken, expiresInSeconds, scope })
      return { ok: true, status }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Неизвестная ошибка' }
    }
  })

  ipcMain.handle('sber:sync', async (event, query) => {
    if (!sberApi) throw new Error('Sber API not initialized')
    const q = (query && typeof query === 'object') ? (query as Record<string, unknown>) : {}
    const accountNumber = typeof q.accountNumber === 'string' && q.accountNumber.trim() ? q.accountNumber.trim() : getSberAccountNumber()
    const defaultDate = process.env.SBER_STATEMENT_DATE || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
    const fromDate = typeof q.fromDate === 'string' && q.fromDate.trim() ? q.fromDate.trim() : defaultDate
    const toDate = typeof q.toDate === 'string' && q.toDate.trim() ? q.toDate.trim() : (process.env.SBER_STATEMENT_DATE || new Date().toISOString().split('T')[0])
    if (!accountNumber) throw new Error('Не задан номер счёта: укажите SBER_ACCOUNT_NUMBER (или SBER_SANDBOX_ACCOUNT_NUMBER / SBER_PRODUCTION_ACCOUNT_NUMBER)')
    const result = await sberApi.sync.fetchAndStage({ accountNumber, fromDate, toDate })
    return { result }
  })

  /**
   * Синхронизация стейджа Sber API в основную таблицу transactions.
   * Дедупликация на стороне БД: unique index (fund_id, bank_transaction_id)
   * + upsert on conflict do nothing → CSV-записи не затрагиваются.
   */
  ipcMain.handle('sber:sync-to-db', async (event) => {
    if (!sberApi) return { ok: false, error: 'Sber API not initialized' }

    const prepared = await sberApi.sync.toTransactionRows()
    if (prepared.rows.length === 0) {
      return {
        ok: true,
        prepared: 0,
        inserted: 0,
        duplicates: 0,
        account: prepared.account,
        message: 'Стейдж пуст — сначала нажмите «Получить транзакции»'
      }
    }

    try {
      const { createClient } = await import('@supabase/supabase-js')
      const url = process.env.VITE_SUPABASE_URL
      // Предпочитаем service role ключ (серверная запись, без передачи в renderer). Fallback — anon.
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
      if (!url || !key) {
        return { ok: false, error: 'Supabase не настроен: задайте VITE_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (или VITE_SUPABASE_ANON_KEY)' }
      }
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        sberLog.warn('Sber sync: используется anon-ключ (возможны ошибки RLS). Рекомендуется SUPABASE_SERVICE_ROLE_KEY в .env')
      }

      const admin = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
      })

      // fund_id берём из БД (первый фонд, как в приложении)
      const { data: fund, error: fundError } = await admin.from('funds').select('id').limit(1).single()
      if (fundError || !fund) {
        return { ok: false, error: `Не найден фонд в БД${fundError?.message ? `: ${fundError.message}` : ''}` }
      }

      let inserted = 0
      let duplicates = 0
      const BATCH = 200
      for (let i = 0; i < prepared.rows.length; i += BATCH) {
        // Не передаём user_id: поле NOT NULL/default зависит от схемы БД; явный null недопустим.
        const batch = prepared.rows.slice(i, i + BATCH).map((r) => ({
          ...r,
          fund_id: fund.id
        }))
        const { data, error } = await admin
          .from('transactions')
          .upsert(batch, {
            onConflict: 'fund_id,bank_transaction_id',
            ignoreDuplicates: false
          })
          .select('id')
        if (error) throw error
        const added = data?.length ?? 0
        inserted += added
        duplicates += batch.length - added
      }

      sberLog.info('Синхронизация Sber → transactions выполнена', {
        prepared: prepared.rows.length,
        inserted,
        duplicates,
        incoming: prepared.incoming,
        outgoing: prepared.outgoing
      })

      return {
        ok: true,
        prepared: prepared.rows.length,
        inserted,
        duplicates,
        incoming: prepared.incoming,
        outgoing: prepared.outgoing,
        account: prepared.account,
        message: `Добавлено: ${inserted}, пропущено (дубли): ${duplicates} из ${prepared.rows.length}`
      }
    } catch (e: any) {
      const reason = e?.message ?? 'Неизвестная ошибка'
      let hint = ''
      if (/column .*data_source/i.test(reason)) {
        hint = ' Выполните миграцию supabase/migrations/20261118_sber_integration.sql (добавляет колонку data_source).'
      } else if (/no unique or exclusion constraint/i.test(reason) || /on conflict/i.test(reason)) {
        hint = ' Выполните миграцию supabase/migrations/20261118_sber_integration.sql (создаёт уникальный индекс для fund_id,bank_transaction_id).'
      } else if (/row-level security|permission denied|not authorized|JWT/i.test(reason)) {
        hint = ' Проверьте права записи/RLS: для серверной синхронизации задайте SUPABASE_SERVICE_ROLE_KEY в .env.'
      } else if (/null value in column .*user_id/i.test(reason)) {
        hint = ' Поле user_id не должно передаваться как null; проверьте схему/ограничения user_id в БД.'
      }
      sberLog.error('Ошибка синхронизации Sber → transactions', { reason })
      return { ok: false, error: `${reason}${hint}` }
    }
})

ipcMain.handle('sber:diagnose', async (event) => {
    if (!isTrustedSender(event)) return null
    const env = sberApi?.config.environment || 'sandbox'
    if (!allowRequest(`sber-diag:${event.sender.id}`, 3, 60_000)) {
      return { ok: false, environment: env, steps: [{ name: 'Лимит', ok: false, detail: 'Слишком частые проверки' }] }
    }
    try {
      return await sberApi!.diagnose()
    } catch (e) {
      sberLog.error('Диагностика не удалась', { reason: e instanceof Error ? e.message : 'unknown' })
      return { ok: false, environment: env, steps: [{ name: 'Ошибка', ok: false, detail: 'См. журнал' }] }
    }
  })

  ipcMain.handle('sber:run-test', async (event, testType: string) => {
    if (!isTrustedSender(event)) return { success: false, error: 'untrusted' }
    
    try {
      if (testType === 'config') {
        const cfg = loadSberConfig();
        return { success: true, data: checkSberConfig(cfg) };
      }
      if (testType === 'auth') {
        return { success: true, data: await sberApi!.diagnose() };
      }
      if (testType === 'transactions') {
        const statements = sberApi!.statements;
        const result = await statements.getTransactionStatement({ 
            accountNumber: getSberAccountNumber() || 'TEST_ACCOUNT',
            fromDate: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
            toDate: new Date().toISOString().split('T')[0]
        });
        return { success: true, data: result };
      }
      return { success: false, error: 'Метод не реализован' };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}

app.whenReady().then(() => {
  setupSessionSecurity()
  setupSberIpc()
  startSberAutoSync()

  ipcMain.handle('dialog:openFile', async (event) => {
    if (!isTrustedSender(event)) {
      console.warn('[SECURITY] Rejected dialog:openFile from untrusted sender')
      return null
    }
    if (!allowRequest(`open:${event.sender.id}`, 5, 10_000)) {
      console.warn('[SECURITY] dialog:openFile rate limit exceeded')
      return null
    }

    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [
        { name: 'Data', extensions: ['xlsx', 'xls', 'csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:saveFile', async (event, defaultPath: unknown) => {
    if (!isTrustedSender(event)) {
      console.warn('[SECURITY] Rejected dialog:saveFile from untrusted sender')
      return null
    }
    if (!allowRequest(`save:${event.sender.id}`, 5, 10_000)) {
      console.warn('[SECURITY] dialog:saveFile rate limit exceeded')
      return null
    }
    if (!isSafeDefaultPath(defaultPath)) {
      console.warn('[SECURITY] Invalid default path for dialog:saveFile')
      return null
    }

    const result = await dialog.showSaveDialog(mainWindow!, { defaultPath })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  ipcMain.handle('shell:openExternal', async (event, url: unknown) => {
    if (!isTrustedSender(event)) return
    if (typeof url !== 'string' || url.length > 2048) return
    if (!allowRequest(`external:${event.sender.id}`, 3, 10_000)) return

    try {
      const { protocol } = new URL(url)
      if (protocol === 'https:' || protocol === 'mailto:') {
        await shell.openExternal(url)
      }
    } catch {
      // ignore malformed URLs
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('web-contents-created', (_event, contents) => {
  hardenWebContents(contents)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
