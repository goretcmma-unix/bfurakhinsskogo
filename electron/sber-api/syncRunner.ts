/**
 * Оркестратор синхронизации Sber API → Supabase.
 *
 * Один прогон:
 *  1. проверяет/обновляет токен (refresh до истечения срока);
 *  2. определяет окно: от последней успешной даты (курсор) до сегодня,
 *     всегда с перекрытием на вчерашний день — поздно проведённые операции
 *     тоже попадут в выборку;
 *  3. забирает выписку по каждому дню периода;
 *  4. нормализует и дедуплицирует;
 *  5. пишет новые операции в Supabase;
 *  6. дописывает историю в CSV;
 *  7. пишет результат в журнал (локально и в sber_sync_runs);
 *  8. двигает курсор только по успешно прочитанным дням.
 */

import { randomUUID } from 'crypto'
import type { SberConfig } from './config'
import type { SberOAuth } from './oauth'
import type { SberSync } from './sync'
import { SberHttpError } from './httpClient'
import { sberLog } from './logger'
import { appendSyncHistory } from './csvHistory'
import { maskAccount } from './sync'
import {
  createAdminClient,
  finishSyncRun,
  resolveTarget,
  startSyncRun,
  upsertTransactions,
  type SupabaseTarget
} from './supabaseWriter'
import {
  bankToday,
  shiftIsoDate,
  SyncStateStore,
  type SyncJournalEntry,
  type SyncTrigger
} from './syncState'

export interface SyncRunnerDeps {
  config: SberConfig
  oauth: SberOAuth
  sync: SberSync
  userDataDir: string
  /** Вызывается после каждого изменения состояния (для UI). */
  onUpdate?: (entry: SyncJournalEntry) => void
}

export interface RunOptions {
  trigger?: SyncTrigger
  fromDate?: string
  toDate?: string
}

/** Окно, которое запрашиваем в этом прогоне. */
interface SyncWindow {
  fromDate: string
  toDate: string
  reason: string
}

const AUTH_ERROR_CODES = new Set([
  'REAUTH_REQUIRED',
  'NO_TOKENS',
  'NO_REFRESH_TOKEN',
  'INVALID_CLIENT',
  'AUTH_FAILED',
  'TOKEN_EXPIRED',
  'INSUFFICIENT_SCOPE',
  'CONFIG_INCOMPLETE'
])

export class SberSyncRunner {
  private readonly state: SyncStateStore
  private running = false
  private lastEntry: SyncJournalEntry | null = null

  constructor(private readonly deps: SyncRunnerDeps) {
    this.state = new SyncStateStore(deps.userDataDir)
  }

  isRunning(): boolean {
    return this.running
  }

  /** Окно синхронизации: курсор + перекрытие на вчерашний день. */
  private async resolveWindow(options: RunOptions): Promise<SyncWindow> {
    const offset = this.deps.config.sync.timezoneOffsetMinutes
    const today = bankToday(offset)

    if (options.fromDate && options.toDate) {
      return { fromDate: options.fromDate, toDate: options.toDate, reason: 'явно заданный период' }
    }

    const cursor = await this.state.loadCursor()
    const yesterday = shiftIsoDate(today, -1)
    const lookbackEdge = shiftIsoDate(today, -this.deps.config.sync.lookbackDays)
    const hardEdge = shiftIsoDate(today, -this.deps.config.sync.maxBackfillDays)

    // Перекрытие: всегда захватываем вчера — операции могут «доехать» позже.
    const cursorStart = cursor.lastSyncedDate
      ? shiftIsoDate(cursor.lastSyncedDate, -1)
      : lookbackEdge

    let fromDate = cursorStart > yesterday ? yesterday : cursorStart
    let reason = cursor.lastSyncedDate
      ? `продолжение с ${cursor.lastSyncedDate} (с перекрытием 1 день)`
      : `первый запуск: последние ${this.deps.config.sync.lookbackDays} дн.`

    if (fromDate < hardEdge) {
      fromDate = hardEdge
      reason = `ограничено предохранителем ${this.deps.config.sync.maxBackfillDays} дн.`
    }

    return { fromDate, toDate: today, reason }
  }

  /**
   * Выполнить прогон. Повторный вызов во время работы возвращает текущий журнал
   * без запуска второго параллельного прогона.
   */
  async run(options: RunOptions = {}): Promise<SyncJournalEntry> {
    if (this.running) {
      sberLog.info('Синхронизация уже выполняется — повторный запуск пропущен')
      const [last] = await this.state.journal(1)
      return last ?? this.emptyEntry(options.trigger ?? 'auto')
    }

    this.running = true
    const entry = this.emptyEntry(options.trigger ?? 'auto')
    entry.status = 'running'
    await this.state.appendJournal(entry)
    this.notify(entry)

    let client: ReturnType<typeof createAdminClient> = null
    let target: SupabaseTarget | null = null

    try {
      const window = await this.resolveWindow(options)
      entry.fromDate = window.fromDate
      entry.toDate = window.toDate
      entry.daysRequested = 0

      const account = this.deps.config.sync.accountNumber
      if (!account) {
        throw new SberHttpError('CONFIG_INCOMPLETE', 'Не задан номер расчётного счёта (SBER_ACCOUNT_NUMBER).')
      }
      entry.accountMasked = maskAccount(account)

      const cursorBefore = await this.state.loadCursor()

      // Токен: если срок истекает — обновляем ДО запроса, чтобы не тратить 401.
      await this.deps.oauth.refreshIfExpiringSoon(15 * 60_000)
      const tokenStatus = await this.deps.oauth.status()
      if (!tokenStatus.hasAccessToken) {
        throw new SberHttpError(
          'NO_TOKENS',
          'Токены Sber не заданы. Нажмите «Авторизовать», чтобы получить их автоматически.'
        )
      }

      sberLog.info('Синхронизация Sber начата', {
        trigger: entry.trigger,
        from: window.fromDate,
        to: window.toDate,
        reason: window.reason,
        account: entry.accountMasked,
        cursorLastSyncedDate: cursorBefore.lastSyncedDate,
        statementMode: this.deps.config.sync.statementMode
      })

      // Подключение к БД (если настроено) — журнал прогона пишется в БД сразу.
      client = createAdminClient()
      if (client) {
        target = await resolveTarget(client)
        if (target) {
          entry.dbRunId = await startSyncRun(client, target.fundId)
          if (target.userId) entry.accountMasked = entry.accountMasked ?? null
        }
        sberLog.info('Supabase для синхронизации', {
          connected: Boolean(client),
          targetResolved: Boolean(target),
          fundId: target?.fundId ? `${target.fundId.slice(0, 8)}…` : null,
          usingServiceRole: target?.usingServiceRole ?? null,
          dbRunId: entry.dbRunId
        })
      } else {
        sberLog.warn('Supabase клиент не создан (нет URL/ключа) — запись в БД будет пропущена')
      }

      const result = await this.deps.sync.fetchRange(
        account,
        window.fromDate,
        window.toDate
      )

      sberLog.info('Выписка обработана (runner)', {
        from: result.fromDate,
        to: result.toDate,
        requestedDays: result.requestedDays,
        fetched: result.fetched,
        unique: result.unique,
        newIncoming: result.incoming,
        outgoing: result.outgoing,
        duplicates: result.duplicates,
        rejected: result.rejected,
        failedDates: result.failedDates.length,
        newPrivate: result.privateTransactions.length,
        newPublic: result.publicTransactions.length,
        dayCounts: (result as any).dayCounts ?? undefined
      })

      entry.fetched = result.fetched
      entry.unique = result.unique
      entry.incoming = result.incoming
      entry.outgoing = result.outgoing
      entry.rejected = result.rejected
      entry.duplicates = result.duplicates
      entry.daysRequested = result.requestedDays
      entry.daysOk = result.requestedDays - result.failedDates.length
      entry.failedDates = result.failedDates

      const rows = this.deps.sync.buildTransactionRows(result.privateTransactions)
      sberLog.info('Подготовка записи в БД', {
        newPrivate: result.privateTransactions.length,
        rowsToUpsert: rows.length,
        hasTarget: Boolean(target),
        sampleRows: rows.slice(0, 5).map((r) => ({
          date: r.transaction_date,
          type: r.type,
          amount: r.amount,
          bank_transaction_id: r.bank_transaction_id
        }))
      })

      if (target && rows.length) {
        const stats = await upsertTransactions(target, rows)
        sberLog.info('Результат upsert в Supabase', {
          inserted: stats.inserted,
          duplicates: stats.duplicates,
          updated: stats.updated,
          insertedIdsSample: stats.insertedIds.slice(0, 10)
        })
        entry.inserted = stats.inserted
        entry.duplicates += stats.duplicates
        const insertedIds = new Set(stats.insertedIds)
        const csv = await appendSyncHistory(this.deps.userDataDir, {
          syncAt: new Date().toISOString(),
          fromDate: window.fromDate,
          toDate: window.toDate,
          transactions: result.privateTransactions,
          insertedIds
        })
        entry.csvRows = csv?.rows ?? 0
      } else if (rows.length) {
        sberLog.warn('Supabase не настроен — операции остались только в стейдже и CSV', {
          rowsToUpsert: rows.length
        })
        const csv = await appendSyncHistory(this.deps.userDataDir, {
          syncAt: new Date().toISOString(),
          fromDate: window.fromDate,
          toDate: window.toDate,
          transactions: result.privateTransactions,
          insertedIds: new Set()
        })
        entry.csvRows = csv?.rows ?? 0
      } else {
        sberLog.info('Новых строк для записи в БД нет', {
          newPrivate: result.privateTransactions.length,
          fetched: result.fetched,
          unique: result.unique,
          duplicates: result.duplicates,
          rejected: result.rejected,
          failedDates: result.failedDates.length
        })
      }

      // Курсор двигаем на последний успешно прочитанный день.
      // При ошибках отдельных дней ставим курсор до первого сбойного дня,
      // чтобы он был запрошен повторно в следующем прогоне (без пропусков операций).
      const latestOk = result.failedDates.length
        ? shiftIsoDate(
          result.failedDates.map((f) => f.date).sort()[0],
          -1
        )
        : window.toDate
      const cursor = await this.state.loadCursor()
      const nextCursorDate =
        cursor.lastSyncedDate && cursor.lastSyncedDate > latestOk ? cursor.lastSyncedDate : latestOk
      await this.state.saveCursor({
        lastSyncedDate: nextCursorDate,
        lastAttemptAt: entry.startedAt,
        lastSuccessAt: new Date().toISOString()
      })

      entry.status = result.failedDates.length ? 'partial' : 'success'
      sberLog.info('Синхронизация Sber завершена', {
        status: entry.status,
        from: window.fromDate,
        to: window.toDate,
        cursorLastSyncedDate: nextCursorDate,
        fetched: entry.fetched,
        inserted: entry.inserted,
        duplicates: entry.duplicates,
        failedDates: entry.failedDates.length
      })

      if (entry.dbRunId && client) {
        await finishSyncRun(client, entry.dbRunId, {
          status: entry.status,
          fetched: entry.fetched,
          inserted: entry.inserted,
          duplicates: entry.duplicates,
          error: null
        })
      }
    } catch (e) {
      const err = e as Error
      const code = e instanceof SberHttpError ? e.code : 'SYNC_FAILED'
      entry.status = 'failed'
      entry.errorCode = code
      entry.error = err.message
      sberLog.error('Синхронизация Sber не удалась (будет повтор при следующем запуске таймера)', {
        code,
        reason: err.message,
        from: entry.fromDate,
        to: entry.toDate
      })

      const cursor = await this.state.loadCursor()
      await this.state.saveCursor({
        ...cursor,
        lastAttemptAt: entry.startedAt
      })

      if (entry.dbRunId && client) {
        await finishSyncRun(client, entry.dbRunId, {
          status: 'failed',
          fetched: entry.fetched,
          inserted: entry.inserted,
          duplicates: entry.duplicates,
          error: `${code}: ${err.message}`
        })
      }
    } finally {
      this.running = false
      entry.finishedAt = new Date().toISOString()
      this.lastEntry = entry
      await this.state.appendJournal(entry)
      this.notify(entry)
    }

    return entry
  }

  /** Сводка для UI: курсор, последний прогон, интервал, состояние токена. */
  async status(): Promise<Record<string, unknown>> {
    const cursor = await this.state.loadCursor()
    const [last] = await this.state.journal(1)
    const token = await this.deps.oauth.status()
    return {
      running: this.running,
      environment: this.deps.config.environment,
      accountMasked: maskAccount(this.deps.config.sync.accountNumber),
      intervalMs: this.deps.config.sync.intervalMs,
      intervalMinutes: this.deps.config.sync.intervalMinutes,
      statementMode: this.deps.config.sync.statementMode,
      lookbackDays: this.deps.config.sync.lookbackDays,
      cursor,
      lastRun: last ?? null,
      token: {
        hasAccessToken: token.hasAccessToken,
        hasRefreshToken: token.hasRefreshToken,
        accessValid: token.accessValid,
        accessExpiresAt: token.accessExpiresAt,
        refreshExpiresAt: token.refreshExpiresAt,
        lastRejectedAt: token.lastRejectedAt
      }
    }
  }

  async journal(limit = 30): Promise<SyncJournalEntry[]> {
    return this.state.journal(limit)
  }

  private emptyEntry(trigger: SyncTrigger): SyncJournalEntry {
    return {
      id: randomUUID(),
      trigger,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      fromDate: null,
      toDate: null,
      environment: this.deps.config.environment,
      accountMasked: null,
      daysRequested: 0,
      daysOk: 0,
      failedDates: [],
      fetched: 0,
      unique: 0,
      incoming: 0,
      outgoing: 0,
      inserted: 0,
      duplicates: 0,
      rejected: 0,
      errorCode: null,
      error: null,
      dbRunId: null,
      csvRows: 0
    }
  }

  private notify(entry: SyncJournalEntry): void {
    try {
      this.deps.onUpdate?.(entry)
    } catch {
      /* подписчик не должен ломать синхронизацию */
    }
  }
}
