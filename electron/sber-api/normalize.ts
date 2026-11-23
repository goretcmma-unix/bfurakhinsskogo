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

const BANK_MARKERS = ['СБЕРБАНК', 'ТБАНК', 'ТИНЬКОФФ', 'ВТБ', 'АЛЬФА', 'СБП', 'НСПК', 'ЦБ РФ']
const BANK_WORD_MARKERS = ['БАНК'] // word-boundary: avoid matching surnames like КУРБАНКАДИЕВ

const ORG_OR_IP_MARKERS = [
  'ООО', 'АО', 'ЗАО', 'ПАО', 'ИП ', 'ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ', 'КФХ', 'БФ', 'АНО', 'НКО', 'ФОНД'
]

// Слова, которые ни при каких обстоятельствах не могут быть именем отправителя.
const PERSON_STOPWORDS = new Set([
  'ЧАСТНОЕ','ЛИЦО','ОКАЗАНИЕ','ФИНАНСОВОЙ','ПОМОЩИ','БЛАГОТВОРИТЕЛЬНОСТЬ','ПОЖЕРТВОВАНИЕ',
  'САДАКА','САДАКЪА','САДАКЬА','САДАКАХ','ПЕРЕВОД','СРЕДСТВ','ОПЛАТА','СЧЕТ','СЧЁТ','УЛ','ДОМ',
  'БАНК','СБП','ПОМОЩЬ','ПОДДЕРЖКА','БЛАГОДАРЯ','БЛАГОДАРЮ','БЛАГОДАРНОСТЬ','ПЕРЕЧИСЛЕНИЕ',
  'ВЗНОС','ДАР','ЦЕЛЕВОЕ','НАЗНАЧЕНИЕ','НДС','КАРТА','СЧЕТА','КОШЕЛЕК','ТЕЛЕФОН','НОМЕР'
])

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasWordMarker(value: string | null | undefined, markers: string[]): boolean {
  const upper = String(value ?? '').toUpperCase()
  return markers.some((m) => {
    const token = m.trim().toUpperCase()
    if (!token) return false
    return new RegExp(`(^|[^А-ЯЁA-Z0-9])${escapeRegExp(token)}([^А-ЯЁA-Z0-9]|$)`, 'i').test(upper)
  })
}

function hasMarker(value: string, markers: string[]): boolean {
  return hasWordMarker(value, markers)
}

function hasBankWordMarker(value: string | null | undefined): boolean {
  return hasWordMarker(value, BANK_WORD_MARKERS)
}

function hasBankMarker(value: string | null | undefined): boolean {
  return hasWordMarker(value, BANK_MARKERS) || hasBankWordMarker(value)
}

function hasOrgOrIpMarker(value: string | null | undefined): boolean {
  return hasWordMarker(value, ORG_OR_IP_MARKERS)
}

/** Разбивает текст на сегменты по '//' — в выписках Сбера ФИО часто лежит во втором сегменте:
 *  «ПАО СБЕРБАНК//ФАМИЛИЯ ИМЯ ОТЧЕСТВО//телефон//адрес//». */
function fioSegments(value: string): string[] {
  return String(value ?? '').split('//').map((s) => s.trim()).filter(Boolean)
}

/** Отрезает адресную и техническую часть: всё после // ; , ( , ИНН, а также по адресным словам. */
function cutTechnicalTail(value: string): string {
  let s = String(value ?? '')
  s = s.split(/\bИНН\b/i)[0]
  s = s.split('//')[0]
  s = s.split(';')[0]
  s = s.split(',')[0]
  s = s.split('(')[0]
  for (const word of ['ул', 'улица', 'д.', 'дом', 'кв.', 'г.', 'с.', 'пос.', 'р-н', 'респ.']) {
    const re = new RegExp(`\\b${word.replace(/[.]/g, '\\.')}`, 'i')
    const parts = s.split(re)
    if (parts.length > 1) s = parts[0]
  }
  return s.trim()
}

function isOnlyLetters(value: string): boolean {
  return /^[А-ЯЁа-яё-]+$/.test(value)
}

function hasDigitsOrRef(value: string): boolean {
  return /[0-9№]/.test(value)
}

function normalizeBankLabel(raw: string): string {
  const s = cutTechnicalTail(raw.split('//')[0] || raw).replace(/\s+/g, ' ').trim()
  if (!s) return 'Не указан'
  if (/сбербанк/i.test(s)) return 'ПАО Сбербанк'
  if (/тинькофф|т-?банк|тбанк/i.test(s)) return 'Т-Банк'
  if (/втб/i.test(s)) return 'ВТБ'
  if (/альфа/i.test(s)) return 'Альфа-Банк'
  return s.length > 80 ? 'Банк-отправитель' : s
}

/**
 * Шаг 3 — форматирование физического лица.
 * 3 слова -> «ФАМИЛИЯ И. О.», 2 слова -> «ФАМИЛИЯ И.», 1 слово -> «ИМЯ».
 * Строки с цифрами/адресными refs, банками или стоп-словами — null.
 */
function formatPerson(raw: string): string | null {
  const source = String(raw ?? '').trim()
  if (!source || hasDigitsOrRef(source)) return null
  if (hasBankMarker(source) || hasOrgOrIpMarker(source)) return null
  const s = cutTechnicalTail(source)
  if (!s) return null
  const words = s.split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  const first = words[0]
  if (!isOnlyLetters(first)) return null
  const firstUpper = first.toUpperCase()
  if (PERSON_STOPWORDS.has(firstUpper)) return null
  if (hasMarker(firstUpper, ORG_OR_IP_MARKERS) || hasMarker(firstUpper, BANK_MARKERS) || hasBankWordMarker(firstUpper)) return null

  const take = words.slice(0, 3).map((w) => w.toUpperCase())
  if (take.some((w) => !isOnlyLetters(w) || PERSON_STOPWORDS.has(w))) return null
  if (take.length === 1) return take[0]
  if (take.length === 2) return `${take[0]} ${take[1][0]}.`
  return `${take[0]} ${take[1][0]}. ${take[2][0]}.`
}

/** Явные маркеры отправителя в тексте: «от Имя», «Отправитель: Имя», «Плательщик: Имя». */
function extractByExplicitMarkers(text: string): string | null {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  // \b не работает с кириллицей в JS (\w = [A-Za-z0-9_]), пробел после слова защищает от ложных срабатываний.
  for (const re of [
    /от\s+([А-ЯЁа-яё-]+(?:\s+[А-ЯЁа-яё-]+){0,3})/i,
    /отправитель\s*[:\-]\s*([А-ЯЁа-яё-]+(?:\s+[А-ЯЁа-яё-]+){0,3})/i,
    /плательщик\s*[:\-]\s*([А-ЯЁа-яё-]+(?:\s+[А-ЯЁа-яё-]+){0,3})/i
  ]) {
    const m = raw.match(re)
    if (m?.[1]) return m[1]
  }
  return null
}

/** Первая валидная форма имени среди кандидатов (каждый проверяется через formatPerson). */
function firstValidName(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (!c) continue
    const formatted = formatPerson(String(c))
    if (formatted) return formatted
  }
  return null
}

/**
 * Единая функция определения имени отправителя (donor) по строгому 4-шаговому алгоритму.
 * payerName — поле плательщика из выписки Сбера.
 * paymentPurpose — назначение платежа.
 *
 * Правила:
 * - Физлицо: «ФАМИЛИЯ И. О.» (без полного ФИО в отчёте).
 * - Организация/ИП: полное юридическое наименование (без тех. хвоста).
 * - СБП/банковский шлюз без достоверного ФИО/орг: банк-отправитель.
 * - Назначение платежа никогда не используется как отправитель.
 * - Если нет ни имени, ни банка: «Не указан».
 */
export function resolveDonorName(
  payerName: string | null,
  paymentPurpose: string | null
): string | null {
  const pn = String(payerName ?? '').trim()
  const pp = String(paymentPurpose ?? '').trim()

  // --- Шаг 1: юрлицо / ИП ---
  if (pn && hasOrgOrIpMarker(pn) && !hasBankMarker(pn)) {
    return cutTechnicalTail(pn) || 'Не указан'
  }

  // --- Шаг 2: банковский шлюз / СБП — имя только из самого payerName (явные маркеры/сегменты), не из назначения ---
  if (pn && hasBankMarker(pn)) {
    const found = firstValidName(
      ...fioSegments(pn),
      extractByExplicitMarkers(pn)
    )
    if (found) return found
    // User rule: SBP/bank gateway, no reliable FIO/org -> keep bank sender, never purpose
    return normalizeBankLabel(pn)
  }

  // --- Шаг 3: физическое лицо ---
  const found = firstValidName(
    extractByExplicitMarkers(pn),
    ...fioSegments(pn),
    pn
  )
  if (found) return found

  // If purpose contains explicit sender markers, allow only that explicit marker (not purpose text itself)
  const markerFromPurpose = firstValidName(extractByExplicitMarkers(pp))
  if (markerFromPurpose) return markerFromPurpose

  // --- Шаг 4: имени вообще нигде нет ---
  return 'Не указан'
}

function cleanCounterpartyName(name: string | null): string | null {
  return resolveDonorName(name, null)
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

  const rawCounterpartyName = asString(pick(input, nameKeys))
  const counterpartyName = isIncoming
    ? resolveDonorName(rawCounterpartyName, purpose)
    : (cutTechnicalTail(rawCounterpartyName) ?? rawCounterpartyName ?? null)
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
