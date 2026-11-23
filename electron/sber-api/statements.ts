/**
 * Получение выписок и транзакций.
 *
 * Scopes подтверждены документацией Сбера:
 *   GET_STATEMENT_ACCOUNT     — выписка по счёту
 *   GET_STATEMENT_TRANSACTION — выписка по транзакциям
 *
 * Промышленный контур принимает выписку за КОНКРЕТНЫЙ ДЕНЬ
 * (`statementDate`), поэтому диапазон запрашивается по дням, а не одной датой.
 * Каждый запрос проходит через `oauth.withAuthorizedRequest`: при 401 токен
 * обновляется по refresh token, и запрос повторяется автоматически.
 */

import type { SberConfig } from './config'
import type { SberOAuth } from './oauth'
import type { TlsOptions } from './httpClient'
import { sberRequest, describeHttpFailure, SberHttpError } from './httpClient'
import { sberLog } from './logger'

export interface StatementQuery {
  /** Номер счёта (маскируйте в UI при необходимости). */
  accountNumber: string
  /** Начало периода, YYYY-MM-DD. */
  fromDate: string
  /** Конец периода, YYYY-MM-DD. */
  toDate: string
}

export interface StatementDayResult {
  date: string
  transactions: Record<string, unknown>[]
  pagesFetched: number
  /** Сырой ответ банка (для summary/диагностики; при пагинации — объединённый). */
  payload?: unknown
}

export interface StatementRangeResult {
  /** Дни, по которым банк ответил успешно (в порядке возрастания даты). */
  days: StatementDayResult[]
  transactions: Record<string, unknown>[]
  /** Дни, которые не удалось получить (сеть/банк). */
  failedDates: Array<{ date: string; reason: string }>
  requestedDays: number
}

const MAX_PAGES = 100

/** Сдвиг даты на N дней (UTC, без влияния часового пояса машины). */
function shiftDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const base = Date.UTC(y, (m || 1) - 1, d || 1)
  const shifted = new Date(base + deltaDays * 86_400_000)
  return shifted.toISOString().slice(0, 10)
}

/** Список дат периода включительно. */
export function enumerateDates(fromDate: string, toDate: string, maxDays = 400): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    throw new SberHttpError('BAD_DATE', 'Даты периода должны быть в формате YYYY-MM-DD.')
  }
  if (fromDate > toDate) return []
  const dates: string[] = []
  let cursor = fromDate
  while (cursor <= toDate && dates.length < maxDays) {
    dates.push(cursor)
    cursor = shiftDate(cursor, 1)
  }
  return dates
}

export class SberStatements {
  constructor(
    private readonly cfg: SberConfig,
    private readonly oauth: SberOAuth
  ) { }

  private get tls(): TlsOptions {
    return {
      p12Path: this.cfg.p12Path,
      p12Password: process.env.SBER_P12_PASSWORD ?? '',
      caPath: this.cfg.caPath || undefined,
      allowInvalidServerCert: this.cfg.allowInvalidServerCert
    }
  }

  private get baseUrl(): string {
    return this.cfg.endpoints[this.cfg.environment].baseUrl.replace(/\/+$/, '')
  }

  /** Абсолютный URL метода выписки (путь может быть относительным). */
  private resolveEndpoint(pathTemplate: string, envVarName: string): string {
    if (!pathTemplate) {
      throw new SberHttpError(
        'CONFIG_INCOMPLETE',
        `Не задан адрес метода выписки (${envVarName}).`
      )
    }
    return /^https?:\/\//i.test(pathTemplate)
      ? pathTemplate
      : `${this.baseUrl}${pathTemplate.startsWith('/') ? '' : '/'}${pathTemplate}`
  }

  /** Извлечение массива операций из одной страницы ответа. */
  private extractPageTransactions(payload: unknown): Record<string, unknown>[] {
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
        const nested = this.extractPageTransactions(value)
        if (nested.length) return nested
      }
    }
    return []
  }

  /** Поиск ссылки на следующую страницу в ответе банка. */
  private findNextHref(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null
    const obj = payload as Record<string, unknown>

    const links = obj._links ?? obj.links
    if (Array.isArray(links)) {
      for (const link of links) {
        if (!link || typeof link !== 'object') continue
        const l = link as Record<string, unknown>
        const rel = String(l.rel ?? l.relType ?? '').toLowerCase()
        if (rel !== 'next') continue
        const href = l.href ?? l.uri ?? l.url
        if (typeof href === 'string' && href.trim()) return href.trim()
      }
    } else if (links && typeof links === 'object') {
      const next = (links as Record<string, unknown>).next
      if (typeof next === 'string' && next.trim()) return next.trim()
      if (next && typeof next === 'object') {
        const href = (next as Record<string, unknown>).href
        if (typeof href === 'string' && href.trim()) return href.trim()
      }
    }

    const direct = obj.next ?? obj.nextPage ?? obj.next_page
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
    if (direct && typeof direct === 'object') {
      const href = (direct as Record<string, unknown>).href
      if (typeof href === 'string' && href.trim()) return href.trim()
    }
    return null
  }

  /** Разрешение next-ссылки: только тот же host/baseUrl. */
  private resolveNextUrl(currentUrl: string, nextHref: string, baseUrl: string): string | null {
    try {
      const current = new URL(currentUrl)
      const resolved = new URL(nextHref, current)
      if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return null
      const allowedBase = new URL(baseUrl)
      const sameHost = resolved.hostname === allowedBase.hostname && resolved.port === allowedBase.port
      const sameAsCurrent = resolved.hostname === current.hostname && resolved.port === current.port
      if (!sameHost && !sameAsCurrent) return null
      return resolved.toString()
    } catch {
      return null
    }
  }

  /** Загрузка всех страниц одного запроса выписки (выполняется под авторизованным запросом). */
  private async fetchAllPages(
    token: string,
    initialUrl: string,
    scope: 'account' | 'transaction'
  ): Promise<{ transactions: Record<string, unknown>[]; pagesFetched: number; payload: unknown; firstStatus: number }> {
    const method = process.env.SBER_STATEMENT_METHOD === 'POST' ? 'POST' : 'GET'
    const seenUrls = new Set<string>()
    const transactions: Record<string, unknown>[] = []
    const pages: unknown[] = []
    let nextUrl: string | null = initialUrl
    let pageIndex = 0
    let firstStatus = 0

    while (nextUrl) {
      if (seenUrls.has(nextUrl)) break
      if (pageIndex >= MAX_PAGES) {
        sberLog.warn('Достигнут лимит страниц выписки, загрузка остановлена', { scope, pages: pageIndex })
        break
      }
      seenUrls.add(nextUrl)

      const result = await sberRequest(this.tls, {
        method,
        url: nextUrl,
        headers: { Authorization: `Bearer ${token}` }
      })

      if (pageIndex === 0) firstStatus = result.status

      if (!result.ok) {
        const failure = describeHttpFailure(result)
        const bodyPreview = (result.text || '').slice(0, 1000)
        // Возвращаем статус наверх — oauth решит, обновлять ли токен и повторять.
        throw new SberHttpError(
          failure.code,
          `${failure.message} (page ${pageIndex + 1})${bodyPreview ? ` Body: ${bodyPreview}` : ''}`,
          result.status,
          result.text
        )
      }

      const pageJson = result.json
      pages.push(pageJson)
      pageIndex++

      const pageTxs = this.extractPageTransactions(pageJson)
      if (pageTxs.length) transactions.push(...pageTxs)

      const nextHref = this.findNextHref(pageJson)
      nextUrl = nextHref ? this.resolveNextUrl(nextUrl, nextHref, this.baseUrl) : null
      if (nextUrl === null && nextHref) {
        sberLog.warn('Ссылка next отклонена (небезопасный или некорректный URL), пагинация остановлена', {
          scope,
          page: pageIndex
        })
      }
      // Защита: next есть, но операций на странице нет — не зацикливаемся.
      if (nextUrl && pageTxs.length === 0) break
    }

    return {
      transactions,
      pagesFetched: pageIndex,
      payload: pages.length === 1 ? pages[0] : { pages },
      firstStatus
    }
  }

  /**
   * Запрос выписки за период в один день (или за диапазон, если банк принимает период).
   * Авторизация: 401 → refresh → повтор.
   */
  private async requestStatement(
    pathTemplate: string,
    envVarName: string,
    scope: 'account' | 'transaction',
    query: { accountNumber: string; fromDate: string; toDate: string }
  ): Promise<StatementDayResult> {
    const endpoint = this.resolveEndpoint(pathTemplate, envVarName)
    const url = new URL(
      endpoint
        .replace('{accountNumber}', encodeURIComponent(query.accountNumber))
        .replace('{fromDate}', encodeURIComponent(query.fromDate))
        .replace('{toDate}', encodeURIComponent(query.toDate))
    )

    if (!url.searchParams.has('accountNumber')) {
      url.searchParams.set('accountNumber', query.accountNumber)
    }
    if (!url.searchParams.has('page')) url.searchParams.set('page', '1')

    const usePeriod = this.cfg.sync.statementMode === 'period'
    if (usePeriod) {
      url.searchParams.set('fromDate', query.fromDate)
      url.searchParams.set('toDate', query.toDate)
    } else if (!url.searchParams.has('statementDate')) {
      url.searchParams.set('statementDate', query.toDate)
    }

    const initialUrl = url.toString()
    const created = await this.oauth.withAuthorizedRequest(async (token) => {
      try {
        const value = await this.fetchAllPages(token, initialUrl, scope)
        return { ok: true, status: 200, value }
      } catch (e) {
        const err = e as SberHttpError
        if (err instanceof SberHttpError && err.status) {
          return { ok: false, status: err.status, bodyText: err.bodyText ?? err.message, value: null as never }
        }
        throw e
      }
    })

    sberLog.info('Выписка получена', {
      scope,
      date: query.toDate,
      pages: created.pagesFetched,
      transactions: created.transactions.length
    })

    return {
      date: query.toDate,
      transactions: created.transactions,
      pagesFetched: created.pagesFetched,
      payload: created.payload
    }
  }

  /** Транзакции за один конкретный день. */
  async getTransactionsForDate(accountNumber: string, date: string): Promise<StatementDayResult> {
    const envKey = this.cfg.environment.toUpperCase()
    return this.requestStatement(
      this.cfg.endpoints[this.cfg.environment].statementTransactionPath,
      `SBER_${envKey}_STATEMENT_TRANSACTION_PATH`,
      'transaction',
      { accountNumber, fromDate: date, toDate: date }
    )
  }

  /**
   * Транзакции за диапазон дат.
   *
   * Если банк работает по `statementDate` (режим по умолчанию) — идём по дням:
   * так догружаются ВСЕ пропущенные дни, а не только последний. В режиме
   * `period` достаточно одного запроса на весь диапазон.
   */
  async getTransactionsForRange(
    accountNumber: string,
    fromDate: string,
    toDate: string,
    options?: { maxDays?: number; onDay?: (date: string, count: number) => void }
  ): Promise<StatementRangeResult> {
    const maxDays = options?.maxDays ?? 400
    const dates = enumerateDates(fromDate, toDate, maxDays)

    if (this.cfg.sync.statementMode === 'period') {
      const envKey = this.cfg.environment.toUpperCase()
      const day = await this.requestStatement(
        this.cfg.endpoints[this.cfg.environment].statementTransactionPath,
        `SBER_${envKey}_STATEMENT_TRANSACTION_PATH`,
        'transaction',
        { accountNumber, fromDate, toDate }
      )
      options?.onDay?.(toDate, day.transactions.length)
      return {
        days: [day],
        transactions: day.transactions,
        failedDates: [],
        requestedDays: 1
      }
    }

    const days: StatementDayResult[] = []
    const failedDates: Array<{ date: string; reason: string }> = []
    const all: Record<string, unknown>[] = []

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i]
      try {
        const day = await this.getTransactionsForDate(accountNumber, date)
        days.push(day)
        all.push(...day.transactions)
        options?.onDay?.(date, day.transactions.length)
        if (day.transactions.length > 0) {
          sberLog.info('День выписки: операции найдены', {
            date,
            count: day.transactions.length,
            pages: day.pagesFetched
          })
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'unknown'
        const code = e instanceof SberHttpError ? e.code : ''
        // Авторизация/конфигурация — нет смысла продолжать по остальным дням.
        if (code === 'REAUTH_REQUIRED' || code === 'NO_TOKENS' || code === 'INVALID_CLIENT' || code === 'CONFIG_INCOMPLETE') {
          throw e
        }
        failedDates.push({ date, reason })
        sberLog.warn('День выписки не получен', { date, reason, code })
      }
      // Пауза между запросами дней: лимит Sber API для /statement/* — 5 TPS.
      // 250ms удерживает последовательную загрузку диапазона в безопасном темпе.
      if (i < dates.length - 1) {
        await new Promise((r) => setTimeout(r, 250))
      }
    }

    return {
      days,
      transactions: all,
      failedDates,
      requestedDays: dates.length
    }
  }

  /** Выписка по счёту — scope GET_STATEMENT_ACCOUNT. */
  async getAccountStatement(query: StatementQuery): Promise<unknown> {
    const envKey = this.cfg.environment.toUpperCase()
    const day = await this.requestStatement(
      this.cfg.endpoints[this.cfg.environment].statementAccountPath,
      `SBER_${envKey}_STATEMENT_ACCOUNT_PATH`,
      'account',
      query
    )
    // Summary-ответ содержит балансы/обороты (не массив транзакций), поэтому
    // возвращаем сырой payload; fallback на transactions для совместимости.
    return day.payload ?? day.transactions
  }

  /** Совместимость: выписка по транзакциям за диапазон (по дням). */
  async getTransactionStatement(query: StatementQuery): Promise<unknown> {
    const range = await this.getTransactionsForRange(query.accountNumber, query.fromDate, query.toDate)
    return { transactions: range.transactions, days: range.days.length, failedDates: range.failedDates }
  }

  /** Диагностика: один день без нормализации (для проверки доступа и формата). */
  async probe(accountNumber: string, date: string): Promise<StatementDayResult> {
    return this.getTransactionsForDate(accountNumber, date)
  }
}
