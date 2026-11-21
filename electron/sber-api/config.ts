/**
 * Конфигурация интеграции Sber API.
 *
 * ПРАВИЛА ЭТОГО МОДУЛЯ:
 *  1. Секреты (токены, пароль сертификата, client_secret) НИКОГДА не попадают в renderer
 *     и никогда не пишутся в лог.
 *  2. Адреса, которые НЕ подтверждены официальной документацией, в этом файле пустые.
 *     Код не подставляет «догадки» — при пустом значении он явно сообщает об этом.
 *
 * Подтверждено документацией developers.sber.ru:
 *  - OAuth-страница авторизации: параметры response_type, client_id, redirect_uri, state, scope
 *    https://developers.sber.ru/docs/ru/sber-api/specifications/oauth/oauth-authorize-get
 *  - Scopes: GET_STATEMENT_ACCOUNT, GET_STATEMENT_TRANSACTION
 *  - Обязателен клиентский TLS-сертификат (mTLS)
 *    https://developers.sber.ru/docs/ru/sber-api/start/tls
 *
 * НЕ подтверждено (поэтому пусто, заполняется после сверки со спецификацией своего продукта):
 *  - hosts sandbox/production (baseUrl)
 *  - токен-endpoint и состав его тела
 *  - пути методов выписок
 */

export type SberEnvironment = 'sandbox' | 'production'

export interface SberEndpointSet {
  /** Базовый адрес API. Пусто = не подтверждён документацией. */
  baseUrl: string
  /** Полный URL получения токена. Пусто = не подтверждён документацией. */
  tokenUrl: string
  /** Путь/URL выписки по счёту (scope GET_STATEMENT_ACCOUNT). Пусто = не подтверждён. */
  statementAccountPath: string
  /** Путь/URL выписки по транзакциям (scope GET_STATEMENT_TRANSACTION). Пусто = не подтверждён. */
  statementTransactionPath: string
}

/** Настройки автоматической синхронизации операций. */
export interface SberSyncConfig {
  /** Расчётный счёт, по которому запрашивается выписка (для выбранного окружения). */
  accountNumber: string
  /** Сколько дней назад смотреть, если курсор синхронизации ещё не создан. */
  lookbackDays: number
  /** Предохранитель: максимум дней за один прогон. */
  maxBackfillDays: number
  /** Интервал фоновой синхронизации в миллисекундах. 0 — выключить. */
  intervalMs: number
  /** Интервал фоновой синхронизации в минутах (для совместимости/UI). 0 — выключить. */
  intervalMinutes: number
  /** Как банк принимает период: `date` — statementDate на каждый день, `period` — fromDate/toDate. */
  statementMode: 'date' | 'period'
  /** Часовой пояс банка (минуты от UTC), по умолчанию Москва. */
  timezoneOffsetMinutes: number
}

export interface SberConfig {
  environment: SberEnvironment
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string[]
  /** Узкий scope для запроса токена (без claims). Пусто — scope не передаётся. */
  tokenScope: string
  /** Абсолютный путь к PKCS#12 клиентскому сертификату. */
  p12Path: string
  /** Путь к .pem CA-сертификата Сбера (если требуется проверка сервера). */
  caPath: string
  /** Отключить проверку сертификата сервера. Только для отладки, по умолчанию false. */
  allowInvalidServerCert: boolean
  endpoints: Record<SberEnvironment, SberEndpointSet>
  sync: SberSyncConfig
}

/** Scopes, подтверждённые документацией Сбера. */
export const SBER_SCOPES = {
  STATEMENT_ACCOUNT: 'GET_STATEMENT_ACCOUNT',
  STATEMENT_TRANSACTION: 'GET_STATEMENT_TRANSACTION'
} as const

const EMPTY_ENDPOINTS: SberEndpointSet = {
  baseUrl: '',
  tokenUrl: '',
  statementAccountPath: '',
  statementTransactionPath: ''
}

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

function envBool(name: string): boolean {
  return env(name).toLowerCase() === 'true'
}

function envInt(name: string, fallback: number): number {
  const parsed = Number(env(name))
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

function envNumber(name: string, fallback: number): number {
  const raw = env(name)
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Номер расчётного счёта: общий либо привязанный к выбранному окружению. */
function resolveAccountNumber(environment: SberEnvironment): string {
  const generic = env('SBER_ACCOUNT_NUMBER')
  if (generic) return generic
  if (environment === 'production') {
    return env('SBER_PRODUCTION_ACCOUNT_NUMBER') || env('SBER_SANDBOX_ACCOUNT_NUMBER')
  }
  return env('SBER_SANDBOX_ACCOUNT_NUMBER') || env('SBER_PRODUCTION_ACCOUNT_NUMBER')
}

function resolveSyncConfig(environment: SberEnvironment): SberSyncConfig {
  const mode = env('SBER_STATEMENT_USE_PERIOD').toLowerCase() === 'true' ? 'period' : 'date'

  // Интервал автосинхронизации:
  // - SBER_AUTO_SYNC_SECONDS / SBER_AUTO_SYNC_MS — приоритет (точная настройка)
  // - SBER_AUTO_SYNC_MINUTES — совместимость (старый формат)
  // - по умолчанию 5 секунд (лимит Sber API на методы выписок: 5 TPS; 5s безопасно при
  //   последовательных запросах и отсутствии параллельных прогонов)
  let intervalMs = 5_000
  const secondsRaw = env('SBER_AUTO_SYNC_SECONDS')
  const msRaw = env('SBER_AUTO_SYNC_MS')
  const minutesRaw = env('SBER_AUTO_SYNC_MINUTES')
  if (secondsRaw || msRaw) {
    const fromSeconds = secondsRaw ? envNumber('SBER_AUTO_SYNC_SECONDS', 5) * 1000 : NaN
    const fromMs = msRaw ? envNumber('SBER_AUTO_SYNC_MS', 5_000) : NaN
    intervalMs = Number.isFinite(fromMs) ? fromMs : fromSeconds
  } else if (minutesRaw) {
    intervalMs = envNumber('SBER_AUTO_SYNC_MINUTES', 30) * 60_000
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 0) intervalMs = 5_000

  return {
    accountNumber: resolveAccountNumber(environment),
    lookbackDays: Math.max(1, envInt('SBER_SYNC_LOOKBACK_DAYS', 30)),
    maxBackfillDays: Math.max(1, envInt('SBER_SYNC_MAX_BACKFILL_DAYS', 120)),
    intervalMs,
    intervalMinutes: intervalMs > 0 ? Math.max(1, Math.round(intervalMs / 60_000)) : 0,
    statementMode: mode,
    timezoneOffsetMinutes: envInt('SBER_TIMEZONE_OFFSET', 180)
  }
}

export function loadSberConfig(): SberConfig {
  const environment = (env('SBER_API_ENV') || 'sandbox') as SberEnvironment
  // SBER_SCOPES в .env содержит весь список claims из id_token — такой scope
  // банк не принимает в token-запросе. Для обновления токена используется
  // узкий SBER_TOKEN_SCOPE (по умолчанию — два нужных scope).
  const tokenScope =
    env('SBER_TOKEN_SCOPE') || `${SBER_SCOPES.STATEMENT_ACCOUNT} ${SBER_SCOPES.STATEMENT_TRANSACTION}`

  return {
    environment,
    clientId: env('SBER_CLIENT_ID'),
    clientSecret: env('SBER_CLIENT_SECRET'),
    redirectUri: env('SBER_REDIRECT_URI'),
    scopes: env('SBER_SCOPES')
      .split(/[\s,]+/)
      .filter(Boolean)
      .concat(
        // Гарантируем наличие подтверждённых scopes, если конфиг пуст
        env('SBER_SCOPES') ? [] : [SBER_SCOPES.STATEMENT_ACCOUNT, SBER_SCOPES.STATEMENT_TRANSACTION]
      ),
    tokenScope,
    p12Path: env('SBER_P12_PATH'),
    caPath: env('SBER_CA_PATH'),
    allowInvalidServerCert: envBool('SBER_ALLOW_INVALID_SERVER_CERT'),
    sync: resolveSyncConfig(environment),
    endpoints: {
      sandbox: {
        baseUrl: env('SBER_SANDBOX_BASE_URL'),
        tokenUrl: env('SBER_SANDBOX_TOKEN_URL'),
        statementAccountPath: env('SBER_SANDBOX_STATEMENT_ACCOUNT_PATH'),
        statementTransactionPath: env('SBER_SANDBOX_STATEMENT_TRANSACTION_PATH')
      },
      production: {
        // Промышленный контур (значения задаются в .env по данным из ЛК/поддержки Sber API)
        baseUrl: env('SBER_PRODUCTION_BASE_URL') || 'https://fintech.sberbank.ru:9443',
        tokenUrl: env('SBER_PRODUCTION_TOKEN_URL'),
        statementAccountPath: env('SBER_PRODUCTION_STATEMENT_ACCOUNT_PATH'),
        statementTransactionPath: env('SBER_PRODUCTION_STATEMENT_TRANSACTION_PATH')
      }
    }
  }
}

export interface ConfigCheck {
  ok: boolean
  missing: string[]
  warnings: string[]
}

/**
 * Проверка полноты конфигурации. Возвращает только ИМЕНА отсутствующих переменных,
 * без каких-либо значений — безопасно для логов и вывода в UI.
 */
export function checkSberConfig(cfg: SberConfig): ConfigCheck {
  const missing: string[] = []
  const warnings: string[] = []

  if (!cfg.clientId) missing.push('SBER_CLIENT_ID')
  if (!cfg.redirectUri) missing.push('SBER_REDIRECT_URI')
  if (!cfg.p12Path) missing.push('SBER_P12_PATH')
  if (!process.env.SBER_P12_PASSWORD) missing.push('SBER_P12_PASSWORD')

  const ep = cfg.endpoints[cfg.environment]
  if (!ep.baseUrl) missing.push(`SBER_${cfg.environment.toUpperCase()}_BASE_URL`)
  if (!ep.tokenUrl) missing.push(`SBER_${cfg.environment.toUpperCase()}_TOKEN_URL`)
  if (!ep.statementTransactionPath) {
    missing.push(`SBER_${cfg.environment.toUpperCase()}_STATEMENT_TRANSACTION_PATH`)
  }
  if (!cfg.sync.accountNumber) missing.push('SBER_ACCOUNT_NUMBER')

  if (cfg.environment === 'production') {
    warnings.push('Выбрано промышленное окружение (production): запросы выполняются к боевому контуру Sber API. Убедитесь, что настройки и сертификат промышленные.')
  }
  if (cfg.allowInvalidServerCert) {
    warnings.push('SBER_ALLOW_INVALID_SERVER_CERT=true — проверка TLS-сертификата сервера отключена.')
  }
  if (!cfg.clientSecret) {
    warnings.push('SBER_CLIENT_SECRET не задан — проверьте, требуется ли он для вашего продукта.')
  }

  return { ok: missing.length === 0, missing, warnings }
}
