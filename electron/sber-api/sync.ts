/**
 * Синхронизация транзакций: выписка по дням → нормализация → дедупликация.
 *
 * Модуль не пишет в БД сам: он готовит набор НОВЫХ операций и сохраняет
 * локальный стейдж. Запись в Supabase, журнал прогонов и CSV-история —
 * в syncRunner.ts.
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { sberLog } from './logger'
import type { SberStatements } from './statements'
import {
  normalizeTransactions,
  dedupeByExternalId,
  sumIncomingByCurrency,
  type PrivateTransaction,
  type PublicTransaction
} from './normalize'

export interface SyncFailedDate {
  date: string
  reason: string
}

export interface SyncRunResult {
  startedAt: string
  finishedAt: string
  fromDate: string
  toDate: string
  requestedDays: number
  /** Сколько операций вернул банк за период. */
  fetched: number
  /** Уникальные операции этого прогона (после дедупликации внутри пачки). */
  unique: number
  incoming: number
  outgoing: number
  /** Отброшено как уже известные (были в стейдже прошлых прогонов). */
  duplicates: number
  /** Записи без даты/суммы. */
  rejected: number
  failedDates: SyncFailedDate[]
  totals: Record<string, number>
  accountMasked: string
  /** Новые приватные операции этого прогона (для записи в БД). */
  privateTransactions: PrivateTransaction[]
  publicTransactions: PublicTransaction[]
  /** Диагностика: сколько операций вернул банк по каждому запрошенному дню. */
  dayCounts?: Array<{ date: string; count: number }>
}

export interface SyncStageFile {
  version: 1
  savedAt: string
  accountNumberMasked: string
  privateTransactions: PrivateTransaction[]
  publicTransactions: PublicTransaction[]
  totals: Record<string, number>
}

/** Маска счёта: публично и в логах видны только последние 4 цифры. */
export function maskAccount(accountNumber: string): string {
  const digits = (accountNumber || '').replace(/\D/g, '')
  if (digits.length <= 4) return '****'
  return `****${digits.slice(-4)}`
}

/** Поиск массива операций в ответе банка (ключи отличаются между продуктами). */
export function extractTransactions(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
  }
  if (!payload || typeof payload !== 'object') return []
  const obj = payload as Record<string, unknown>

  for (const key of ['transactions', 'operations', 'items', 'statement', 'payments']) {
    const value = obj[key]
    if (Array.isArray(value)) {
      return value.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
    }
    if (value && typeof value === 'object') {
      const nested = extractTransactions(value)
      if (nested.length) return nested
    }
  }
  return []
}

export class SberSync {
  private readonly dir: string

  constructor(
    private readonly statements: SberStatements,
    userDataDir: string
  ) {
    this.dir = join(userDataDir, 'sber-secrets')
  }

  private get stagePath(): string {
    return join(this.dir, 'sync-stage.json')
  }

  private async loadStage(): Promise<SyncStageFile | null> {
    try {
      const text = await fs.readFile(this.stagePath, 'utf8')
      return JSON.parse(text) as SyncStageFile
    } catch {
      return null
    }
  }

  private async saveStage(stage: SyncStageFile): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 })
    await fs.writeFile(this.stagePath, JSON.stringify(stage), { mode: 0o600 })
  }

  async loadStagePublic(): Promise<SyncStageFile | null> {
    return this.loadStage()
  }

  /**
   * Получить выписку за диапазон и подготовить:
   *  - список НОВЫХ операций (их пишет раннер в БД);
   *  - обновлённый локальный стейдж (офлайн-просмотр и CSV-история).
   */
  async fetchRange(
    accountNumber: string,
    fromDate: string,
    toDate: string,
    options?: { onDay?: (date: string, count: number) => void }
  ): Promise<SyncRunResult> {
    const startedAt = new Date().toISOString()
    const range = await this.statements.getTransactionsForRange(accountNumber, fromDate, toDate, {
      onDay: options?.onDay
    })

    const dayCounts = range.days.map((d) => ({ date: d.date, count: d.transactions.length }))
    sberLog.info('Выписка получена по дням', {
      account: maskAccount(accountNumber),
      from: fromDate,
      to: toDate,
      requestedDays: range.requestedDays,
      failedDates: range.failedDates,
      dayCounts
    })

    const { private: privateAll, public: publicAll, rejected, duplicates: batchDuplicates } =
      normalizeTransactions(range.transactions, accountNumber)

    const outgoing = privateAll.filter((t) => t.direction === 'outgoing').length

    const privateUnique = dedupeByExternalId(privateAll)
    const publicUnique = dedupeByExternalId(publicAll)

    const previous = await this.loadStage()
    const knownIds = new Set(previous?.privateTransactions.map((t) => t.externalId) ?? [])
    const privateNew = privateUnique.filter((t) => !knownIds.has(t.externalId))

    const knownPublicIds = new Set(previous?.publicTransactions.map((t) => t.externalId) ?? [])
    const publicNew = publicUnique.filter((t) => !knownPublicIds.has(t.externalId))

    const duplicates = privateUnique.length - privateNew.length + batchDuplicates

    const mergedPrivate = dedupeByExternalId([
      ...(previous?.privateTransactions ?? []),
      ...privateNew
    ])
    const mergedPublic = dedupeByExternalId([
      ...(previous?.publicTransactions ?? []),
      ...publicNew
    ])

    const finishedAt = new Date().toISOString()
    await this.saveStage({
      version: 1,
      savedAt: finishedAt,
      accountNumberMasked: maskAccount(accountNumber),
      privateTransactions: mergedPrivate,
      publicTransactions: mergedPublic,
      totals: sumIncomingByCurrency(mergedPublic)
    })

    const result: SyncRunResult = {
      startedAt,
      finishedAt,
      fromDate,
      toDate,
      requestedDays: range.requestedDays,
      fetched: range.transactions.length,
      unique: privateUnique.length,
      incoming: privateNew.filter((t) => t.direction === 'incoming').length,
      outgoing,
      duplicates,
      rejected,
      failedDates: range.failedDates,
      totals: sumIncomingByCurrency(mergedPublic),
      accountMasked: maskAccount(accountNumber),
      privateTransactions: privateNew,
      publicTransactions: publicNew,
      dayCounts
    }

    sberLog.info('Выписка обработана', {
      account: result.accountMasked,
      from: fromDate,
      to: toDate,
      days: range.requestedDays,
      fetched: result.fetched,
      unique: result.unique,
      newIncoming: result.incoming,
      duplicates: result.duplicates,
      rejected: result.rejected,
      failedDays: result.failedDates.length,
      newPrivate: result.privateTransactions.length,
      newPrivateSample: result.privateTransactions.slice(0, 10).map((t) => ({
        date: t.operationDate,
        at: t.operationAtFull,
        dir: t.direction,
        amount: t.amountMinor / 100,
        ext: t.externalId
      }))
    })
    return result
  }

  /** Совместимость со старым вызовом. */
  async fetchAndStage(query: {
    accountNumber: string
    fromDate: string
    toDate: string
  }): Promise<SyncRunResult> {
    return this.fetchRange(query.accountNumber, query.fromDate, query.toDate)
  }
/** Сводка стейджа без приватных полей — безопасно отдавать в UI. */
  async stageSummary(): Promise<Record<string, unknown> | null> {
    const stage = await this.loadStage()
    if (!stage) return null
    return {
      savedAt: stage.savedAt,
      account: stage.accountNumberMasked,
      privateCount: stage.privateTransactions.length,
      publicCount: stage.publicTransactions.length,
      totals: stage.totals,
      lastPublic: stage.publicTransactions.slice(-5)
    }
  }

  /** Публичный набор для отчётов (без ПДн). */
  async getPublicTransactions(): Promise<PublicTransaction[]> {
    const stage = await this.loadStage()
    return stage?.publicTransactions ?? []
  }

  /** Полный набор для записи во внутреннюю таблицу БД. */
  async getPrivateTransactions(): Promise<PrivateTransaction[]> {
    const stage = await this.loadStage()
    return stage?.privateTransactions ?? []
  }

  /**
   * Преобразование приватных операций в строки таблицы transactions.
   * Разделение CREDIT/DEBIT → income/expense. Дедупликация — по bank_transaction_id
   * (в БД уникальный индекс (fund_id, bank_transaction_id)).
   */
  buildTransactionRows(transactions: PrivateTransaction[]): Array<Record<string, unknown>> {
    return transactions
      .filter((t) => t.direction !== 'unknown')
      .map((t) => {
        const isIncome = t.direction === 'incoming'
        const full = (t.operationAtFull || '').trim()
        const transactionDate = /\d{1,2}:\d{2}/.test(full) ? full : t.operationDate
        return {
          transaction_date: transactionDate,
          type: isIncome ? 'income' : 'expense',
          amount: t.amountMinor / 100,
          currency: t.currency,
          description: t.purpose ?? (isIncome ? 'Поступление (Sber API)' : 'Списание (Sber API)'),
          category_id: null,
          sender_name: isIncome ? t.counterpartyName : null,
          sender_bank: isIncome ? t.counterpartyBank : null,
          sender_account_masked: isIncome ? maskAccount(t.counterpartyAccount ?? '') : null,
          recipient_name: !isIncome ? t.counterpartyName : null,
          recipient_bank: !isIncome ? t.counterpartyBank : null,
          recipient_account_masked: !isIncome ? maskAccount(t.counterpartyAccount ?? '') : null,
          source_type: isIncome ? 'donation' : 'other',
          comment: '[Sber API] Импортировано автоматически',
          document_status: 'expected',
          bank_transaction_id: t.externalId,
          payment_method: isIncome ? 'transfer' : 'spisanie',
          is_public: true,
          data_source: 'sber_api'
        }
      })
  }

  /** Строки из последнего стейджа (совместимость с ручной кнопкой синка). */
  async toTransactionRows(): Promise<{
    rows: Array<Record<string, unknown>>
    incoming: number
    outgoing: number
    account: string | null
    savedAt: string | null
  }> {
    const stage = await this.loadStage()
    if (!stage) {
      return { rows: [], incoming: 0, outgoing: 0, account: null, savedAt: null }
    }

    const rows = this.buildTransactionRows(stage.privateTransactions)
    return {
      rows,
      incoming: rows.filter((r) => r.type === 'income').length,
      outgoing: rows.filter((r) => r.type === 'expense').length,
      account: stage.accountNumberMasked,
      savedAt: stage.savedAt
    }
  }
}
