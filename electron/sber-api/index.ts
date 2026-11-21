/**
 * Sber API — публичное API модуля для main-процесса Electron.
 *
 * Renderer и публичный сайт НЕ имеют прямого доступа к этому модулю:
 * импульсы приходят только через заранее определённые IPC-каналы (main.ts),
 * без возможности указать произвольный URL.
 */

import { loadSberConfig, checkSberConfig, SBER_SCOPES, type SberConfig } from './config'
import { SecureStore } from './secureStore'
import { SberOAuth, coerceTtlSeconds, parseExpiryDate } from './oauth'
import { SberStatements, enumerateDates } from './statements'
import { SberSync } from './sync'
import { SberSyncRunner } from './syncRunner'
import { sberRequest, describeHttpFailure, SberHttpError, type TlsOptions } from './httpClient'
import { sberLog } from './logger'
import type { SyncJournalEntry, SyncTrigger } from './syncState'

export interface SberModuleOptions {
  /** Каталог userData приложения для защищённого хранилища. */
  userDataDir: string
  /** Уведомление UI о ходе/результате синхронизации. */
  onSyncUpdate?: (entry: SyncJournalEntry) => void
}

export interface DiagnosticStep {
  name: string
  ok: boolean
  detail: string
}

export interface DiagnosticsResult {
  ok: boolean
  environment: string
  steps: DiagnosticStep[]
}

export class SberApi {
  readonly config: SberConfig
  readonly store: SecureStore
  readonly oauth: SberOAuth
  readonly statements: SberStatements
  readonly sync: SberSync
  readonly runner: SberSyncRunner

  constructor(options: SberModuleOptions) {
    this.config = loadSberConfig()
    this.store = new SecureStore(options.userDataDir)
    this.oauth = new SberOAuth(this.config, this.store)
    this.statements = new SberStatements(this.config, this.oauth)
    this.sync = new SberSync(this.statements, options.userDataDir)
    this.runner = new SberSyncRunner({
      config: this.config,
      oauth: this.oauth,
      sync: this.sync,
      userDataDir: options.userDataDir,
      onUpdate: options.onSyncUpdate
    })
    sberLog.info('Модуль Sber API инициализирован', {
      environment: this.config.environment,
      account: this.config.sync.accountNumber ? `****${this.config.sync.accountNumber.slice(-4)}` : 'не задан',
      intervalMs: this.config.sync.intervalMs,
      intervalMinutes: this.config.sync.intervalMinutes,
      statementMode: this.config.sync.statementMode
    })
  }

  /**
   * Первичное заполнение токенов из .env (если в защищённом хранилище пусто).
   * Нужно для перехода со старой схемы, где токены лежали в переменных окружения.
   */
  async bootstrapTokensFromEnv(): Promise<boolean> {
    const status = await this.oauth.status()
    if (status.hasAccessToken) return false
    const accessToken = (process.env.SBER_ACCESS_TOKEN ?? '').trim()
    if (!accessToken) return false
    await this.oauth.setTokens({
      accessToken,
      refreshToken: (process.env.SBER_REFRESH_TOKEN ?? '').trim(),
      expiresInSeconds: coerceTtlSeconds(process.env.SBER_TOKEN_EXPIRES_IN) ?? undefined,
      scope: this.config.tokenScope
    })
    sberLog.info('Токены перенесены из .env в защищённое хранилище')
    return true
  }

  /** Запуск синхронизации (используется и планировщиком, и кнопкой в UI). */
  async syncNow(trigger: SyncTrigger = 'manual', range?: { fromDate?: string; toDate?: string }) {
    return this.runner.run({ trigger, ...range })
  }

  async syncStatus(): Promise<Record<string, unknown>> {
    return this.runner.status()
  }

  async syncJournal(limit = 30): Promise<SyncJournalEntry[]> {
    return this.runner.journal(limit)
  }

  private get tls(): TlsOptions {
    return {
      p12Path: this.config.p12Path,
      p12Password: process.env.SBER_P12_PASSWORD ?? '',
      caPath: this.config.caPath || undefined,
      allowInvalidServerCert: this.config.allowInvalidServerCert
    }
  }

  /** Полная проверка конфигурации и состояния, без сетевых запросов и без секретов. */
  async inspect(): Promise<Record<string, unknown>> {
    const check = checkSberConfig(this.config)
    const oauth = await this.oauth.status()
    const authorize = this.oauth.buildAuthorizeUrl()
    const endpoints = this.config.endpoints[this.config.environment]

    return {
      environment: this.config.environment,
      scopes: this.config.scopes,
      confirmedScopes: SBER_SCOPES,
      config: {
        ok: check.ok,
        missing: check.missing,
        warnings: check.warnings
      },
      endpoints: {
        baseUrl: endpoints.baseUrl ? 'configured' : 'not set',
        tokenUrl: endpoints.tokenUrl ? 'configured' : 'not set',
        statementAccount: endpoints.statementAccountPath ? 'configured' : 'not set',
        statementTransaction: endpoints.statementTransactionPath ? 'configured' : 'not set'
      },
      oauth,
      authorizeAvailable: Boolean(authorize),
      log: sberLog.recent(50)
    }
  }

  /**
   * Проверка доступности Sber API (sandbox/production):
   *  1) окружение и конфигурация;
   *  2) адреса (с подсказками по официальным host'ам);
   *  3) mTLS-сертификат;
   *  4) токены и срок действия;
   *  5) сетевой запрос к baseUrl (без выполнения банковских операций).
   */
  async diagnose(): Promise<DiagnosticsResult> {
    const steps: DiagnosticStep[] = []
    const env = this.config.environment
    const endpoints = this.config.endpoints[env]
    const envKey = env.toUpperCase()

    steps.push({
      name: 'Окружение',
      ok: env === 'sandbox' || env === 'production',
      detail: env === 'production' ? 'Production (промышленный контур)' : 'Sandbox (тестовый контур)'
    })

    const check = checkSberConfig(this.config)
    steps.push({
      name: 'Конфигурация',
      ok: check.ok,
      detail: check.ok
        ? 'Все обязательные параметры заданы'
        : `Не заданы: ${check.missing.join(', ')}`
    })

    if (endpoints.baseUrl) {
      let ok = true
      let detail = endpoints.baseUrl
      try {
        const parsed = new URL(endpoints.baseUrl)
        if (env === 'sandbox') {
          const isSandboxHost = /fintech-test/i.test(parsed.hostname)
          ok = parsed.protocol === 'https:' && isSandboxHost && parsed.port === '9443'
          detail = ok
            ? `${parsed.hostname}:${parsed.port} — официальный Sandbox`
            : `${parsed.hostname} — не похоже на Sandbox (ожидается fintech-test.sberbank.ru:9443)`
        } else {
          const isProdHost = /fintech\.sberbank\.ru/i.test(parsed.hostname)
          ok = parsed.protocol === 'https:' && isProdHost
          detail = ok
            ? `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''} — промышленный API Sber`
            : `${parsed.hostname} — проверьте адрес промышленного API (ожидается fintech.sberbank.ru:9443)`
        }
      } catch {
        ok = false
        detail = 'Некорректный URL'
      }
      steps.push({ name: env === 'sandbox' ? 'Адрес Sandbox' : 'Адрес Production API', ok, detail })
    }

    if (endpoints.tokenUrl) {
      if (env === 'sandbox') {
        const good = endpoints.tokenUrl.includes('/ic/sso/api/oauth/token')
        steps.push({
          name: 'Адрес токена',
          ok: good,
          detail: good ? 'соответствует официальной коллекции' : 'не совпадает с /ic/sso/api/oauth/token'
        })
      } else {
        steps.push({
          name: 'Адрес токена',
          ok: true,
          detail: 'задан (проверьте соответствие настройкам из ЛК/поддержки Sber API)'
        })
      }
    }

    if (endpoints.statementTransactionPath) {
      const isProdHost = /(^|\/\/)fintech\.sberbank\.ru/i.test(endpoints.statementTransactionPath)
      const isSandboxHost = /(^|\/\/)fintech-test/i.test(endpoints.statementTransactionPath)
      let ok = true
      let detail = endpoints.statementTransactionPath
      if (env === 'sandbox' && isProdHost) {
        ok = false
        detail = 'В sandbox-конфигурации указан production-хост fintech.sberbank.ru — проверьте настройки'
      } else if (env === 'production' && isSandboxHost) {
        ok = false
        detail = 'В production-конфигурации указан sandbox-хост fintech-test.sberbank.ru — проверьте настройки'
      }
      steps.push({ name: 'Адрес выписок', ok, detail })
    }

    const hasCert = Boolean(this.config.p12Path) && Boolean(process.env.SBER_P12_PASSWORD)
    if (!hasCert) {
      steps.push({
        name: 'mTLS-сертификат',
        ok: false,
        detail:
          'НЕ ПРОВЕРЕН: не заданы SBER_P12_PATH и/или SBER_P12_PASSWORD. ' +
          `Без клиентского сертификата Sber ${env} не выполняет mTLS-аутентификацию.`
      })
    } else {
      let certOk = true
      let certDetail = 'клиентский сертификат найден'
      try {
        const { statSync } = await import('fs')
        const st = statSync(this.config.p12Path)
        if (!st.isFile() || st.size === 0) {
          certOk = false
          certDetail = 'файл сертификата пустой или не является файлом'
        }
      } catch {
        certOk = false
        certDetail = 'файл сертификата не найден по SBER_P12_PATH'
      }
      steps.push({ name: 'mTLS-сертификат', ok: certOk, detail: certDetail })
    }

    if (hasCert && endpoints.baseUrl) {
      try {
        const res = await sberRequest(this.tls, {
          method: 'GET',
          url: endpoints.baseUrl,
          timeoutMs: 10_000
        })
        steps.push({
          name: 'TLS-соединение',
          ok: true,
          detail: `рукопожатие с клиентским сертификатом прошло (HTTP ${res.status})`
        })
      } catch (e) {
        const code = e instanceof SberHttpError ? e.code : 'UNKNOWN'
        steps.push({
          name: 'TLS-соединение',
          ok: false,
          detail: e instanceof Error ? e.message : `Ошибка TLS (${code})`
        })
      }
    }

    const oauthStatus = await this.oauth.status()
    steps.push({
      name: 'Токены',
      ok: oauthStatus.hasAccessToken,
      detail: !oauthStatus.hasAccessToken
        ? 'Access token не задан'
        : oauthStatus.accessValid
          ? 'Access token действителен'
          : oauthStatus.hasRefreshToken
            ? 'Access token истёк — будет обновлён по Refresh token'
            : 'Access token истёк, Refresh token отсутствует'
    })

    if (endpoints.baseUrl && oauthStatus.hasAccessToken) {
      try {
        const token = await this.oauth.getValidAccessToken()
        const result = await sberRequest(this.tls, {
          method: 'GET',
          url: endpoints.baseUrl,
          headers: { Authorization: `Bearer ${token}` },
          timeoutMs: 15_000
        })
        if (result.ok || result.status === 404) {
          steps.push({
            name: env === 'sandbox' ? 'Доступность Sandbox' : 'Доступность Production',
            ok: true,
            detail: `Ответ получен (HTTP ${result.status}) — соединение и авторизация приняты`
          })
        } else {
          const failure = describeHttpFailure(result)
          steps.push({
            name: env === 'sandbox' ? 'Доступность Sandbox' : 'Доступность Production',
            ok: false,
            detail: `HTTP ${result.status}: ${failure.message}`
          })
        }
      } catch (e) {
        steps.push({
          name: env === 'sandbox' ? 'Доступность Sandbox' : 'Доступность Production',
          ok: false,
          detail: e instanceof Error ? e.message : 'Неизвестная ошибка'
        })
      }
    } else {
      steps.push({
        name: env === 'sandbox' ? 'Доступность Sandbox' : 'Доступность Production',
        ok: false,
        detail: `Пропущено: нужны SBER_${envKey}_BASE_URL и токены`
      })
    }

    const ok = steps.every((s) => s.ok)
    sberLog.info('Диагностика Sber API завершена', { ok, environment: env })
    return { ok, environment: env, steps }
  }
}

export { sberLog, SBER_SCOPES, checkSberConfig, loadSberConfig }
export { sberRequest } from './httpClient'
export type { SberConfig }
export type { PublicTransaction, PrivateTransaction } from './normalize'
export { normalizeTransactions, sumIncomingByCurrency } from './normalize'
export { parseExpiryDate, coerceTtlSeconds, getBankOffsetMinutes } from './oauth'
export { enumerateDates } from './statements'
export type { StatementQuery, StatementDayResult, StatementRangeResult } from './statements'
export type { SyncRunResult } from './sync'
export type { SyncJournalEntry, SyncCursor, SyncStatus, SyncTrigger } from './syncState'
