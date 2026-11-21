/**
 * Нормализация банковских транзакций в два независимых представления:
 *
 *   1. PrivateTransaction — полная банковская информация. Хранится ТОЛЬКО в БД
 *      (серверная часть / таблица с ограниченным доступом). На сайт не попадает.
 *
 *   2. PublicTransaction — минимальный набор для публичного отчёта:
 *      дата, сумма, валюта, безопасный идентификатор, категория.
 *      Никаких ФИО, счетов, карт, ИНН, телефонов, назначений платежа, токенов.
 *
 * Формат ответа Sber API зависит от продукта, поэтому поля читаются по списку
 * известных вариантов имён (accountDebit/creditDebit/debitCreditIndicator и т.п.),
 * а неизвестные ключи сохраняются в raw для последующего разбора.
 */

import { createHash } from 'crypto'

export type TxDirection = 'incoming' | 'outgoing' | 'unknown'

export interface PrivateTransaction {
  /** Стабильный хеш операции — защита от повторной записи. */
  externalId: string
  /** Идентификатор операции от банка (если передан). */
  bankId: string | null
  /** Дата операции в ISO (YYYY-MM-DD) — без времени, чтобы не светить часовой пояс. */
  operationDate: string
  /** Полный ISO-таймштамп для внутренней аналитики. */
  operationAtFull: string | null
  amountMinor: number
  currency: string
  direction: TxDirection
  // --- приватные поля: НИКОГДА не публикуются ---
  accountNumber: string | null
  counterpartyName: string | null
  counterpartyAccount: string | null
  counterpartyBank: string | null
  counterpartyInn: string | null
  purpose: string | null
  /** Исходный объект операции банка (для аудита, только во внутренней БД). */
  raw: Record<string, unknown>
}

export interface PublicTransaction {
  /** Тот же безопасный идентификатор — для дедупликации и сверки. */
  externalId: string
  date: string
  amount: number
  currency: string
  /** «Пожертвование» и т.п. — без имён отправителей. */
  category: string
  /** Анонимизированная группа источника: individual / company / unknown. */
  sourceType: 'individual' | 'company' | 'unknown'
}

export interface NormalizeResult {
  private: PrivateTransaction
  /** null для исходящих операций — они не публикуются. */
  public: PublicTransaction | null
}

/** Признаки исходящей операции в различных продуктах Sber API. */
const OUTGOING_MARKERS = [
  'debit',
  'outgoing',
  'expense',
  'расход',
  'списание',
  'исходящ'
]

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = obj[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

/**
 * Извлечение суммы. Сбер присылает её тремя способами:
 *  - число: amount: 150000.5
 *  - строка: "150000,50"
 *  - ВЛОЖЕННЫЙ ОБЪЕКТ: amount: { amount: 15000000, currencyName: 'RUB' }
 *    (мional units — в копейках), amountRub, rurTransfer
 */
function extractAmount(obj: Record<string, unknown>): { raw: unknown; minor: number | null } {
  for (const key of ['amount', 'sum', 'value', 'transactionAmount', 'operationAmount']) {
    const value = obj[key]
    if (value === undefined || value === null || value === '') continue

    // Вложенный объект Сбера { amount: копейки, currencyName }
    if (typeof value === 'object' && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>
      const innerAmount = nested.amount ?? nested.sum ?? nested.value
      if (innerAmount !== undefined && innerAmount !== null && innerAmount !== '') {
        return { raw: innerAmount, minor: parseAmountToMinor(innerAmount) }
      }
      continue
    }

    const minor = parseAmountToMinor(value)
    if (minor !== null) return { raw: value, minor }
  }
  return { raw: undefined, minor: null }
}

/** Число/строка → минорные единицы (копейки). null если распознать не удалось. */
function parseAmountToMinor(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(Math.abs(value) * 100)
  }
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const cleaned = raw.replace(/\s/g, '').replace(',', '.')
  const num = Number(cleaned)
  if (!Number.isFinite(num)) return null
  return Math.round(Math.abs(num) * 100)
}

function asString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const s = String(value).trim()
  return s ? s : null
}

/** Сумма всегда приводится к минорным единицам (копейки) целым числом. */
export function toMinorUnits(value: unknown, currency: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(Math.abs(value) * 100)
  }
  const raw = asString(value)
  if (!raw) return 0
  // Поддержка формата "1 234,56" и "1234.56"
  const cleaned = raw.replace(/\s/g, '').replace(',', '.')
  const num = Number(cleaned)
  if (!Number.isFinite(num)) return 0
  return Math.round(Math.abs(num) * 100)
}

/** Дата в YYYY-MM-DD без времени — единый формат для публичного отчёта. */
export function toDateOnly(value: unknown): string {
  const raw = asString(value)
  if (!raw) return ''
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  // Формат DD.MM.YYYY
  const ru = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/)
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`
  const d = new Date(raw)
  if (isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

export function detectDirection(obj: Record<string, unknown>, amountRaw: unknown): TxDirection {
  const markers = [
    pick(obj, ['direction', 'operationType', 'type', 'creditDebitIndicator', 'debitCreditIndicator']),
    pick(obj, ['accountDebit', 'accountCredit'])
  ]
    .map((v) => (typeof v === 'string' ? v.toLowerCase() : ''))
    .join(' ')

  if (OUTGOING_MARKERS.some((m) => markers.includes(m))) return 'outgoing'
  if (markers.includes('credit') || markers.includes('incoming') || markers.includes('поступл')) {
    return 'incoming'
  }

  // Если сумма в ответе отрицательная — это списание.
  if (typeof amountRaw === 'number' && amountRaw < 0) return 'outgoing'
  const asText = asString(amountRaw)
  if (asText && asText.trim().startsWith('-')) return 'outgoing'

  return 'unknown'
}

const COMPANY_HINTS = ['ооо', 'ао', 'пао', 'зао', 'ип', 'ltd', 'llc', 'inc', 'ooo', 'фонд', 'bank', 'банк']

/** Известные опечатки в фамилиях от Сбера — подменяются перед записью в БД. */
const TYPO_MAP: Record<string, string> = {
  'ААЛИЕВА': 'АЛИЕВА',
  'ИВВАНОВ': 'ИВАНОВ',
  'ППЕТРОВ': 'ПЕТРОВ',
  'ССИДОРОВ': 'СИДОРОВ',
  'ККУЗНЕЦОВ': 'КУЗНЕЦОВ',
  'ММИРОВ': 'МИРОВ',
}

function classifySource(counterpartyName: string | null): PublicTransaction['sourceType'] {
  if (!counterpartyName) return 'unknown'
  const lower = counterpartyName.toLowerCase()
  if (COMPANY_HINTS.some((h) => lower.includes(h))) return 'company'
  // Имя физлица (есть разделитель слов) — но наружу всё равно уходит только метка.
  return /\s/.test(lower.trim()) ? 'individual' : 'unknown'
}

/** Очистка имени отправителя: убирает банк, цифры, разделители (//, /) и ОПФ,
 *  форматирует как «ФАМИЛИЯ И.О» (фамилия + инициалы имени и отчества).
 *  Пример: «ПАО//Сбербанк МАГОМЕДОВ ЭСКЕНДЕР МАГОМЕДШАРИПОВИЧ//36000703»
 *  → «МАГОМЕДОВ Э.М»
 *  Пример: «ААЛИЕВА М. Д.» → «ААЛИЕВА М. Д.»
 *  Пример: «Д А. К.» → «Д А. К.» (нет длинного слова — оставляет как есть) */
function cleanCounterpartyName(name: string | null): string | null {
  if (!name) return null
  let s = name.trim()
  // цифры — мусор
  s = s.replace(/\d+/g, ' ')
  // слэши — разделители
  s = s.replace('[/]+', ' ')
  // отдельные токены организационно-правовых форм — шум
  s = s.replace(/\b(ооо|ао|пао|зао|ип|ltd|llc|inc|банк|банке|банка)\b/gi, ' ')
  // разбиваем по пробелам
  const words = s.split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  // фамилия — самое длинное слово (буквы только)
  const surnameIdx = words.reduce((best, w, i) => {
    const clean = w.replace(/[^А-ЯA-ZЁ]/gi, '')
    return clean.length > words[best].replace(/[^А-ЯA-ZЁ]/gi, '').length ? i : best
  }, 0)
  const surnameBase = words[surnameIdx].replace(/[^А-ЯA-ZЁ]/gi, '').toUpperCase()
  if (surnameBase.length === 0) return null
  // исправляем известные опечатки фамилий (например, ААЛИЕВА → АЛИЕВА)
  let surname = TYPO_MAP[surnameBase] ?? surnameBase
  // инициалы — короткие однобуквенные слова (кроме фамилии)
  const initials = words
    .filter((_, i) => i !== surnameIdx)
    .map((w) => w.replace(/[^А-ЯA-ZЁ]/gi, '').toUpperCase())
    .filter((w) => w.length >= 1 && w.length <= 2)
    .map((w) => w + '.')
  return initials.length > 0 ? `${surname} ${initials.join(' ')}` : surname
}

/**
 * Стабильный идентификатор операции.
 * Приоритет — bankId: он не меняется между выгрузками. Если банк не дал id,
 * строится хеш от даты/суммы/валюты/номера счёта и назначения платежа.
 */
export function buildExternalId(parts: {
  bankId: string | null
  date: string
  amountMinor: number
  currency: string
  accountNumber: string | null
  purpose: string | null
}): string {
  if (parts.bankId) return `sber:${parts.bankId}`
  const basis = [
    parts.date,
    String(parts.amountMinor),
    parts.currency,
    parts.accountNumber ?? '',
    parts.purpose ?? ''
  ].join('|')
  return `sber:h:${createHash('sha256').update(basis).digest('hex').slice(0, 32)}`
}

/**
 * Плоский вид операции: реальный ответ Сбера прячет реквизиты в вложенном
 * объекте rurTransfer (payerName, payeeAccount, ...). Сливаем их наверх:
 * значения верхнего уровня имеют приоритет.
 */
function flattenTransaction(input: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = { ...input }
  for (const key of ['rurTransfer', 'currencyTransfer', 'transfer']) {
    const nested = input[key]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      for (const [k, v] of Object.entries(nested as Record<string, unknown>)) {
        if (flat[k] === undefined || flat[k] === null || flat[k] === '') flat[k] = v
      }
      // departmentalInfo внутри rurTransfer тоже сливаем
      const inner = (nested as Record<string, unknown>).departmentalInfo
      if (inner && typeof inner === 'object') {
        for (const [k, v] of Object.entries(inner as Record<string, unknown>)) {
          if (flat[k] === undefined || flat[k] === null || flat[k] === '') flat[k] = v
        }
      }
    }
  }
  return flat
}

/** Один объект операции банка → нормализованная запись. */
export function normalizeTransaction(
  inputRaw: Record<string, unknown>,
  accountNumber: string | null = null
): NormalizeResult {
  const input = flattenTransaction(inputRaw)
  const currencyRaw = (asString(pick(input, ['currency', 'currencyName', 'currencyCode', 'currencyISO'])) ?? 'RUB').toUpperCase()
  // Sandbox Сбера использует RUR — это устаревший код рубля, нормализуем в RUB
  const currency = currencyRaw === 'RUR' ? 'RUB' : currencyRaw
  // Сумма: число, строка или вложенный объект Сбера { amount, currencyName }
  const { raw: amountRaw, minor: extractedMinor } = extractAmount(input)
  const dateRaw = pick(input, [
    'date',
    'operationDate',
    'valueDate',
    'documentDate',
    'bookingDate',
    'transactionDate'
  ])

  const bankId = asString(
    pick(input, ['id', 'operationId', 'uuid', 'transactionId', 'documentNumber', 'paymentId'])
  )
  const date = toDateOnly(dateRaw)
  // Приоритет извлечённой суммы; fallback на toMinorUnits для старых форматов
  const amountMinor = extractedMinor ?? toMinorUnits(amountRaw, currency)
  const direction = detectDirection(input, amountRaw)
  const purpose = asString(pick(input, [
    'purpose', 'paymentPurpose', 'description', 'note'
  ]))

  // Контрагент зависит от направления: для поступления это плательщик,
  // для списания — получатель. Это даёт осмысленные данные для аудита и UI.
  const isIncoming = direction === 'incoming'
  const nameKeys = isIncoming
    ? ['counterpartyName', 'payerName', 'receiverName', 'name', 'correspondentName']   // кто ПРИНЁС деньги
    : ['counterpartyName', 'payeeName', 'receiverName', 'name', 'correspondentName']   // кому УШЛИ деньги
  const accountKeys = isIncoming
    ? ['counterpartyAccount', 'payerAccount', 'receiverAccount', 'account']
    : ['counterpartyAccount', 'payeeAccount', 'receiverAccount', 'account']
  const bankKeys = isIncoming
    ? ['counterpartyBank', 'payerBankBic', 'bankName', 'bic']
    : ['counterpartyBank', 'payeeBankBic', 'bankName', 'bic']
  const innKeys = isIncoming
    ? ['counterpartyInn', 'payerInn', 'inn']
    : ['counterpartyInn', 'payeeInn', 'inn']

  const counterpartyName = cleanCounterpartyName(asString(pick(input, nameKeys)))
  const counterpartyAccount = asString(pick(input, accountKeys))
  const counterpartyBank = asString(pick(input, bankKeys))
  const counterpartyInn = asString(pick(input, innKeys))

  const externalId = buildExternalId({
    bankId,
    date,
    amountMinor,
    currency,
    accountNumber,
    purpose
  })

  const priv: PrivateTransaction = {
    externalId,
    bankId,
    operationDate: date,
    operationAtFull: asString(dateRaw),
    amountMinor,
    currency,
    direction,
    accountNumber,
    counterpartyName,
    counterpartyAccount,
    counterpartyBank,
    counterpartyInn,
    purpose,
    raw: input
  }

  // Публикуем ТОЛЬКО входящие поступления.
  if (direction !== 'incoming') {
    return { private: priv, public: null }
  }

  const pub: PublicTransaction = {
    externalId,
    date,
    amount: amountMinor / 100,
    currency,
    category: 'Пожертвование',
    sourceType: classifySource(counterpartyName)
  }

  return { private: priv, public: pub }
}

/** Массовая нормализация с отбрасыванием записей без даты/суммы и дедупликацией. */
export function normalizeTransactions(
  list: Record<string, unknown>[],
  accountNumber: string | null = null
): { private: PrivateTransaction[]; public: PublicTransaction[]; rejected: number; duplicates: number } {
  const privateList: PrivateTransaction[] = []
  const publicList: PublicTransaction[] = []
  const seen = new Set<string>()
  let rejected = 0
  let duplicates = 0

  for (const item of list) {
    const result = normalizeTransaction(item, accountNumber)
    if (!result.private.operationDate || result.private.amountMinor <= 0) {
      rejected++
      continue
    }
    // Одна и та же операция в выписке может прийти дважды — сохраняем один раз.
    if (seen.has(result.private.externalId)) {
      duplicates++
      continue
    }
    seen.add(result.private.externalId)
    privateList.push(result.private)
    if (result.public) publicList.push(result.public)
  }

  return { private: privateList, public: publicList, rejected, duplicates }
}

/** Сумма поступлений в рублях (по каждой валюте отдельно — валюты не суммируются). */
export function sumIncomingByCurrency(publicList: PublicTransaction[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const tx of publicList) {
    totals[tx.currency] = (totals[tx.currency] ?? 0) + tx.amount
  }
  for (const key of Object.keys(totals)) {
    totals[key] = Math.round(totals[key] * 100) / 100
  }
  return totals
}

/**
 * Убирает дубли внутри пачки по externalId (защита от повторного сохранения).
 */
export function dedupeByExternalId<T extends { externalId: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (seen.has(item.externalId)) continue
    seen.add(item.externalId)
    out.push(item)
  }
  return out
}
