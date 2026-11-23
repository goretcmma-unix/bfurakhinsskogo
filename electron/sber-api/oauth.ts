/**
 * OAuth-слой Sber API.
 *
 * Что реализовано:
 *  - приём уже выданной пары токенов (access + refresh) и её безопасное сохранение;
 *  - проверка срока действия access token (с запасом, чтобы не ловить 401 на границе);
 *  - автоматическое обновление access token через refresh token;
 *  - формирование ссылки авторизации (если для продукта нужен шаг consent);
 *  - обработка ошибок авторизации понятными кодами.
 *
 * Что НЕ реализовано намеренно: адреса и тело запроса токена берутся ТОЛЬКО из
 * конфигурации (SBER_*_TOKEN_URL + SBER_TOKEN_GRANT_TYPE / поля формы), потому что
 * точный формат зависит от продукта и должен быть сверен со спецификацией.
 * Если адрес не задан — возвращается понятная ошибка CONFIG_INCOMPLETE.
 */

import type { SberConfig } from './config'
import type { SecureStore, TokenPair, TokenSource } from './secureStore'
import { sberRequest, describeHttpFailure, SberHttpError, type TlsOptions } from './httpClient'
import { sberLog } from './logger'

/** Запас до истечения: токен считаем протухшим за 60 секунд до конца. */
const EXPIRY_SKEW_MS = 60_000

/**
 * Признак авторизационной ошибки (токен недействителен/просрочен).
 * 403 сюда НЕ включаем: это чаще недостаток прав (scope), обновление не поможет.
 * Отличаем по телу ответа: если банк явно говорит про токен — считаем авторизационным.
 */
function isAuthError(status: number, bodyText: string): boolean {
  if (status === 401) return true
  if (status !== 403) return false
  const text = (bodyText || '').toLowerCase()
  return /invalid_token|token.*(expired|invalid)|expired.*token|unauthorized/.test(text)
}

export interface OAuthStatus {
  configured: boolean
  hasAccessToken: boolean
  hasRefreshToken: boolean
  accessExpiresAt: string | null
  /** Сколько осталось жить токену, в миллисекундах (null = срок неизвестен). */
  accessExpiresInMs: number | null
  accessValid: boolean
  expirySource: TokenSource
  lastRejectedAt: string | null
  refreshExpiresAt: string | null
  refreshValid: boolean | null
  scope: string
  environment: string
  /** Когда токен потребует обновления (для планировщика). */
  refreshRecommendedAt: string | null
}

export interface SetTokensInput {
  accessToken: string
  refreshToken?: string
  /** Срок жизни access token в секундах (если известен из ответа банка). */
  expiresInSeconds?: number
  /** Абсолютная дата истечения — например, указанная в личном кабинете Сбера. */
  expiresAt?: string | number | Date
  /** Срок жизни refresh token в секундах. */
  refreshExpiresInSeconds?: number
  scope?: string
}

/**
 * Парсит дату истечения токена из личного кабинета.
 *
 * ЧАСОВОЙ ПОЯС — ключевой момент:
 *  - Сбер показывает время в ЛК, как правило, по Москве (UTC+3).
 *  - Компьютер может стоять в любой зоне.
 *  - Поэтому зона банка задаётся явно через SBER_TIMEZONE_OFFSET (в минутах, по
 *    умолчанию 180 = UTC+3). Дата из ЛК трактуется в этой зоне, а не в локальной.
 *  - Если в строке уже есть явная зона (Z, +03:00), она имеет приоритет.
 *  - Для ISO без зоны используем ту же зону банка.
 *
 * Возвращает UNIX-время в мс (абсолютный момент) или null, если разобрать не удалось.
 */
export function parseExpiryDate(
  input: string | number | Date | null | undefined,
  offsetMinutes: number = getBankOffsetMinutes()
): number | null {
  if (input === null || input === undefined || input === '') return null
  if (input instanceof Date) {
    const t = input.getTime()
    return Number.isFinite(t) ? t : null
  }
  if (typeof input === 'number') {
    return input > 1e12 ? input : input * 1000
  }

  const raw = String(input).trim()

  // Строка из одних цифр — это НЕ дата (иначе `new Date('3600')` даёт год 3600,
  // и токен «живёт вечно», из-за чего обновление никогда не срабатывает).
  if (/^\d{1,9}$/.test(raw)) return null

  return parseDateString(raw, offsetMinutes)
}

/**
 * Распознать «время жизни в секундах», переданное вместо абсолютной даты.
 * `expires_in` из OAuth и ручной ввод вроде "3600" означают TTL, а не дату.
 */
export function coerceTtlSeconds(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input) && input > 0) return Math.trunc(input)
  const value = String(input ?? '').trim()
  if (!/^\d{1,9}$/.test(value)) return null
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

function parseDateString(raw: string, offsetMinutes: number): number | null {
  // Явная зона в строке (Z или +HH:MM / -HH:MM) — доверяем ей
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)

  // DD.MM.YYYY [HH:MM[:SS]] — формат личного кабинета
  const ru = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (ru) {
    const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = ru
    // Считаем UTC-время с учётом зоны банка: берём компоненты как «время в зоне банка»
    const asUtc = Date.UTC(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(mi),
      Number(ss)
    )
    // Вычитаем смещение, чтобы получить абсолютный момент
    const t = hasExplicitZone ? new Date(raw).getTime() : asUtc - offsetMinutes * 60_000
    return Number.isFinite(t) ? t : null
  }

  // ISO без зоны: «2026-12-18T07:27:18» или только дата «2026-12-18» — в зоне банка
  const isoNoZone = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  )
  if (isoNoZone) {
    const [, yyyy, mm, dd, hh = '00', mi = '00', ss = '00'] = isoNoZone
    const asUtc = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss))
    return asUtc - offsetMinutes * 60_000
  }

  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : null
}

/** Смещение часового пояса банка в минутах (по умолчанию Москва, UTC+3). */
export function getBankOffsetMinutes(): number {
  const raw = process.env.SBER_TIMEZONE_OFFSET
  const parsed = Number(raw)
  if (Number.isFinite(parsed) && Math.abs(parsed) <= 14 * 60) return parsed
  return 180
}

/**
 * Длина токена — это НЕ секрет, но позволяет заметить, что токен сменился.
 * Никакие символы токена не сохраняются и не логируются.
 */
function tokenMarker(token: string): string {
  return token ? `len:${token.length}` : 'none'
}

export class SberOAuth {
  /** Один refresh-запрос за раз: параллельные обновления ломают ротацию токена. */
  private refreshInFlight: Promise<string> | null = null

  constructor(
    private readonly cfg: SberConfig,
    private readonly store: SecureStore
  ) { }

  private get tls(): TlsOptions {
    return {
      p12Path: this.cfg.p12Path,
      p12Password: process.env.SBER_P12_PASSWORD ?? '',
      caPath: this.cfg.caPath || undefined,
      allowInvalidServerCert: this.cfg.allowInvalidServerCert
    }
  }

  /**
   * Принять пару токенов, выданную банком, и сохранить её.
   * Срок определяется из expiresInSeconds (ответ OAuth) либо из expiresAt
   * (дата из личного кабинета), иначе — неизвестен.
   */
  async setTokens(input: SetTokensInput): Promise<OAuthStatus> {
    const accessToken = (input.accessToken ?? '').trim()
    if (!accessToken) {
      throw new SberHttpError('NO_ACCESS_TOKEN', 'Access token не передан.')
    }

    const now = Date.now()
    let expiresAt: number | null = null
    let expirySource: TokenSource = 'unknown'

    // Порядок важен: сначала TTL в секундах (ответ OAuth или "3600"),
    // и только потом абсолютная дата из личного кабинета.
    const ttlSeconds =
      input.expiresInSeconds && input.expiresInSeconds > 0
        ? input.expiresInSeconds
        : coerceTtlSeconds(input.expiresAt)

    if (ttlSeconds) {
      expiresAt = now + ttlSeconds * 1000
      expirySource = 'oauth'
    } else {
      const absolute = parseExpiryDate(input.expiresAt)
      if (absolute !== null) {
        expiresAt = absolute
        expirySource = 'manual'
      }
    }

    if (expiresAt !== null && expiresAt <= now) {
      sberLog.warn('Переданный срок действия токена уже прошёл — нужна новая пара', {
        expiresAt: new Date(expiresAt).toISOString()
      })
    }

    const pair: TokenPair = {
      accessToken,
      refreshToken: (input.refreshToken ?? '').trim(),
      expiresAt,
      refreshExpiresAt:
        input.refreshExpiresInSeconds && input.refreshExpiresInSeconds > 0
          ? now + input.refreshExpiresInSeconds * 1000
          : null,
      expirySource,
      accessTokenMarker: tokenMarker(accessToken),
      lastRejectedAt: null,
      scope: input.scope ?? this.cfg.scopes.join(' '),
      savedAt: now
    }

    const { persisted } = await this.store.saveTokens(pair)
    sberLog.info('Токены приняты', {
      persisted,
      hasRefreshToken: Boolean(pair.refreshToken),
      expirySource,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : 'unknown'
    })
    return this.status()
  }

  async status(): Promise<OAuthStatus> {
    const pair = await this.store.loadTokens()
    const now = Date.now()
    const expiresInMs = pair?.expiresAt ? pair.expiresAt - now : null
    const accessValid =
      Boolean(pair?.accessToken) &&
      (expiresInMs === null || expiresInMs - EXPIRY_SKEW_MS > 0) &&
      !pair?.lastRejectedAt
    const refreshValid =
      pair && pair.refreshToken
        ? pair.refreshExpiresAt === null || pair.refreshExpiresAt > now
        : null

    return {
      configured: Boolean(this.cfg.endpoints[this.cfg.environment].tokenUrl),
      hasAccessToken: Boolean(pair?.accessToken),
      hasRefreshToken: Boolean(pair?.refreshToken),
      accessExpiresAt: pair?.expiresAt ? new Date(pair.expiresAt).toISOString() : null,
      accessExpiresInMs: expiresInMs,
      accessValid,
      expirySource: pair?.expirySource ?? 'unknown',
      lastRejectedAt: pair?.lastRejectedAt ? new Date(pair.lastRejectedAt).toISOString() : null,
      refreshExpiresAt: pair?.refreshExpiresAt ? new Date(pair.refreshExpiresAt).toISOString() : null,
      refreshValid,
      scope: pair?.scope ?? this.cfg.scopes.join(' '),
      environment: this.cfg.environment,
      refreshRecommendedAt:
        pair?.expiresAt && pair.refreshToken
          ? new Date(pair.expiresAt - EXPIRY_SKEW_MS).toISOString()
          : null
    }
  }

  /**
   * Вернуть рабочий access token: если он есть и не истёк — сразу,
   * если истёк и есть refresh token — обновить и сохранить новую пару.
   */
  async getValidAccessToken(): Promise<string> {
    const pair = await this.store.loadTokens()
    if (!pair?.accessToken) {
      throw new SberHttpError(
        'NO_TOKENS',
        'Токены не заданы. Вставьте Access/Refresh token в настройки Sber или выполните авторизацию.'
      )
    }

    const notExpired = !pair.expiresAt || pair.expiresAt - EXPIRY_SKEW_MS > Date.now()
    if (notExpired) return pair.accessToken

    if (!pair.refreshToken) {
      throw new SberHttpError(
        'TOKEN_EXPIRED',
        'Access token истёк, а Refresh token не задан. Получите новую пару токенов.'
      )
    }

    sberLog.info('Access token истёк — обновляем через refresh token')
    return this.refresh(pair.refreshToken)
  }

  /**
   * Обновление access token по refresh token.
   * Адрес и формат тела — из конфигурации (после сверки со спецификацией продукта).
   */
  async refresh(refreshToken?: string): Promise<string> {
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.performRefresh(refreshToken).finally(() => {
      this.refreshInFlight = null
    })
    return this.refreshInFlight
  }

  /**
   * Фактическое обновление токена.
   *
   * Особенности промышленного контура (проверено запросами):
   *  - тело принимается только как application/x-www-form-urlencoded
   *    (JSON-тело разбирается как пустое → `invalid_request`);
   *  - client_id и client_secret обязательны, иначе `invalid_request`;
   *  - scope из .env содержит claims из id_token и банком не принимается,
   *    поэтому передаётся узкий cfg.tokenScope;
   *  - просроченный refresh token даёт `invalid_grant` → нужна переавторизация.
   */
  private async performRefresh(refreshToken?: string): Promise<string> {
    const pair = await this.store.loadTokens()
    const rt = (refreshToken ?? pair?.refreshToken ?? '').trim()
    if (!rt) {
      throw new SberHttpError('NO_REFRESH_TOKEN', 'Refresh token не задан.')
    }

    const tokenUrl = this.cfg.endpoints[this.cfg.environment].tokenUrl
    if (!tokenUrl) {
      throw new SberHttpError(
        'CONFIG_INCOMPLETE',
        'Не задан адрес обновления токена (SBER_PRODUCTION_TOKEN_URL / SBER_SANDBOX_TOKEN_URL).'
      )
    }

    const grantType = process.env.SBER_TOKEN_GRANT_TYPE || 'refresh_token'

    const fields: Record<string, string> = {
      grant_type: grantType,
      refresh_token: rt
    }
    // Банк требует оба параметра клиента — без них ответ `invalid_request`.
    if (this.cfg.clientId) fields.client_id = this.cfg.clientId
    if (this.cfg.clientSecret) fields.client_secret = this.cfg.clientSecret
    if (this.cfg.tokenScope) fields.scope = this.cfg.tokenScope

    const result = await sberRequest(this.tls, {
      method: 'POST',
      url: tokenUrl,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString()
    })

    if (!result.ok) {
      const failure = describeHttpFailure(result)
      const bankError = String((result.json as Record<string, unknown> | null)?.error ?? '')
      const bankDescription = String(
        (result.json as Record<string, unknown> | null)?.error_description ?? ''
      )
      sberLog.error('Обновление токена отклонено банком', {
        status: result.status,
        code: failure.code,
        bankError,
        bankDescription
      })

      if (bankError === 'invalid_grant') {
        throw new SberHttpError(
          'REAUTH_REQUIRED',
          'Refresh token просрочен или отозван — обновление невозможно. ' +
            'Требуется повторная авторизация в СберБизнес (кнопка «Авторизовать»).',
          result.status
        )
      }
      if (bankError === 'invalid_client') {
        throw new SberHttpError(
          'INVALID_CLIENT',
          'Банк отклонил client_id/client_secret либо сертификат mTLS не соответствует приложению.',
          result.status
        )
      }

      throw new SberHttpError(failure.code, `Не удалось обновить токен. ${failure.message}`, result.status)
    }

    const body = (result.json ?? {}) as Record<string, unknown>
    const accessToken = String(body.access_token ?? '')
    const newRefresh = String(body.refresh_token ?? rt)
    const expiresIn = Number(body.expires_in)
    const refreshExpiresIn = Number(body.refresh_expires_in)

    if (!accessToken) {
      throw new SberHttpError('BAD_TOKEN_RESPONSE', 'Банк не вернул access_token в ответе.')
    }

    const now = Date.now()
    const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : null

    await this.store.saveTokens({
      accessToken,
      refreshToken: newRefresh,
      expiresAt,
      refreshExpiresAt:
        Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0
          ? now + refreshExpiresIn * 1000
          : null,
      expirySource: expiresAt ? 'oauth' : 'unknown',
      // Новая пара ещё не проверялась банком — отметку об отказе снимаем.
      lastRejectedAt: null,
      accessTokenMarker: tokenMarker(accessToken),
      scope: String(body.scope ?? this.cfg.scopes.join(' ')),
      savedAt: now
    })

    sberLog.info('Токен обновлён и сохранён', {
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : 'unknown',
      refreshRotated: newRefresh !== rt
    })
    return accessToken
  }

  private async hasRefreshToken(): Promise<boolean> {
    const pair = await this.store.loadTokens()
    return Boolean(pair?.refreshToken)
  }

  /**
   * Банк ответил 401 (токен недействителен/просрочен).
   * Помечаем токен протухшим — следующий вызов getValidAccessToken() обновит его.
   * Для 403 метод НЕ вызывается: недостаток прав обновлением не лечится.
   */
  async markTokenRejected(token: string): Promise<void> {
    const pair = await this.store.loadTokens()
    if (!pair || pair.accessToken !== token) return
    await this.store.saveTokens({ ...pair, lastRejectedAt: Date.now() })
    sberLog.warn('Токен помечен как отклонённый банком (401)', {
      marker: tokenMarker(token)
    })
  }

  /**
   * Выполнить запрос с автоповтором после обновления токена.
   *
   * Логика:
   *  - 401 — токен протух: одно обновление и один повтор;
   *  - 403 — ЗАПРЕТ ПРАВ (scope/сертификат): токен НЕ обновляется,
   *          ошибка сразу пробрасывается наверх с понятным текстом;
   *  - прочие ошибки — без повторов.
   */
  async withAuthorizedRequest<T>(
    run: (token: string) => Promise<{ ok: boolean; status: number; bodyText?: string; value: T }>
  ): Promise<T> {
    let token = await this.getValidAccessToken()
    let result = await run(token)
    if (result.ok) return result.value

    if (result.status === 401) {
      await this.markTokenRejected(token)
      if (!(await this.hasRefreshToken())) {
        throw new SberHttpError(
          'TOKEN_EXPIRED',
          'Банк ответил 401, а Refresh token не задан. Получите новую пару токенов в личном кабинете.',
          401
        )
      }
      if (!this.cfg.endpoints[this.cfg.environment].tokenUrl) {
        throw new SberHttpError(
          'CONFIG_INCOMPLETE',
          'Банк ответил 401, но адрес обновления (SBER_SANDBOX_TOKEN_URL) не задан. ' +
            'Укажите его, чтобы обновление выполнялось автоматически.',
          401
        )
      }

      // Ровно одна попытка обновления и один повтор.
      token = await this.refresh()
      result = await run(token)
      if (result.ok) return result.value

      throw new SberHttpError(
        'AUTH_FAILED',
        `После обновления токена банк снова ответил HTTP ${result.status}. ` +
          'Обновление не помогло — проверьте права приложения.',
        result.status
      )
    }

    if (result.status === 403 || isAuthError(result.status, result.bodyText ?? '')) {
      // Права/доступ, а не протухший токен — обновление не выполняется.
      throw new SberHttpError(
        'INSUFFICIENT_SCOPE',
        'Банк ответил 403: у токена недостаточно прав (scope) либо сертификат не принят. ' +
          'Проверьте, что выданы GET_STATEMENT_ACCOUNT и GET_STATEMENT_TRANSACTION, ' +
          'и что .p12 принадлежит этому приложению. Обновление токена здесь не поможет.',
        403
      )
    }

    const bodyPreview = (result.bodyText || '').slice(0, 1000)
    throw new SberHttpError(
      'REQUEST_FAILED',
      `Запрос завершился с HTTP ${result.status}.${bodyPreview ? ` Body: ${bodyPreview}` : ''}`,
      result.status,
      result.bodyText
    )
  }

  /**
   * Проактивное обновление: обновляет токен, если до истечения осталось
   * меньше порога. Возвращает true, если обновление выполнялось.
   */
  async refreshIfExpiringSoon(thresholdMs = 10 * 60_000): Promise<boolean> {
    const pair = await this.store.loadTokens()
    if (!pair?.refreshToken || !pair.expiresAt) return false
    if (pair.expiresAt - Date.now() > thresholdMs) return false
    try {
      await this.refresh()
      return true
    } catch (e) {
      sberLog.warn('Плановое обновление токена не удалось', {
        reason: e instanceof Error ? e.message : 'unknown'
      })
      return false
    }
  }

  /**
   * Обмен authorization code на пару токенов.
   * Тот же token-endpoint и та же форма тела, что и у refresh.
   */
  async exchangeAuthorizationCode(code: string): Promise<OAuthStatus> {
    const tokenUrl = this.cfg.endpoints[this.cfg.environment].tokenUrl
    if (!tokenUrl) {
      throw new SberHttpError(
        'CONFIG_INCOMPLETE',
        'Не задан адрес получения токена (SBER_PRODUCTION_TOKEN_URL / SBER_SANDBOX_TOKEN_URL).'
      )
    }
    const cleanCode = (code ?? '').trim()
    if (!cleanCode) throw new SberHttpError('NO_CODE', 'Код авторизации не передан.')

    const fields: Record<string, string> = {
      grant_type: 'authorization_code',
      code: cleanCode,
      redirect_uri: this.cfg.redirectUri
    }
    if (this.cfg.clientId) fields.client_id = this.cfg.clientId
    if (this.cfg.clientSecret) fields.client_secret = this.cfg.clientSecret

    const result = await sberRequest(this.tls, {
      method: 'POST',
      url: tokenUrl,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString()
    })

    if (!result.ok) {
      const failure = describeHttpFailure(result)
      const bankError = String((result.json as Record<string, unknown> | null)?.error ?? '')
      throw new SberHttpError(
        bankError || failure.code,
        `Банк не выдал токены по коду авторизации. ${failure.message}`,
        result.status
      )
    }

    const body = (result.json ?? {}) as Record<string, unknown>
    const accessToken = String(body.access_token ?? '')
    if (!accessToken) {
      throw new SberHttpError('BAD_TOKEN_RESPONSE', 'Банк не вернул access_token в ответе.')
    }
    const expiresIn = Number(body.expires_in)
    const refreshExpiresIn = Number(body.refresh_expires_in)

    sberLog.info('Авторизация завершена: получена новая пара токенов', {
      hasRefreshToken: Boolean(body.refresh_token),
      expiresIn: Number.isFinite(expiresIn) ? expiresIn : 'unknown'
    })

    return this.setTokens({
      accessToken,
      refreshToken: String(body.refresh_token ?? ''),
      expiresInSeconds: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : undefined,
      refreshExpiresInSeconds:
        Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0 ? refreshExpiresIn : undefined,
      scope: this.cfg.tokenScope
    })
  }

  /**
   * Ссылка авторизации. Параметры подтверждены документацией:
   * response_type, client_id, redirect_uri, state, scope.
   */
  buildAuthorizeUrl(): { url: string; state: string } | null {
    const base = process.env.SBER_AUTHORIZE_URL
    if (!base || !this.cfg.clientId || !this.cfg.redirectUri) return null

    const state = cryptoState()
    const url = new URL(base)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', this.cfg.clientId)
    url.searchParams.set('redirect_uri', this.cfg.redirectUri)
    url.searchParams.set('state', state)
    // Только рабочие scope: список claims из id_token банк не принимает.
    // openid обязателен для authorization code flow (требование банка).
    const authScope = this.cfg.tokenScope.includes('openid')
      ? this.cfg.tokenScope
      : `${this.cfg.tokenScope} openid`
    url.searchParams.set('scope', authScope)
    return { url: url.toString(), state }
  }
}

function cryptoState(): string {
  // randomUUID без импорта crypto в этом файле ради читаемости — через globalThis
  return globalThis.crypto.randomUUID().replace(/-/g, '')
}
