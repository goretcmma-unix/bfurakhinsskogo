/**
 * Журнал работы Sber-модуля без секретов.
 *
 * Любая строка перед записью проходит через redact(): токены, пароли, значения
 * заголовков Authorization и тела с client_secret вырезаются.
 */

export type SberLogLevel = 'INFO' | 'WARN' | 'ERROR'

export interface SberLogEntry {
  ts: string
  level: SberLogLevel
  message: string
  details?: Record<string, unknown>
}

const SECRET_KEY_PATTERN =
  /(access_?token|refresh_?token|client_?secret|password|passphrase|authorization|cookie|set-cookie|p12|private_?key)/i

/** Значения, которые никогда не должны попасть в лог. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b[A-Fa-f0-9]{32,}\b/g // длинные hex/opaque-токены
]

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]'
  if (value === null || value === undefined) return value

  if (typeof value === 'string') {
    let out = value
    for (const re of SECRET_VALUE_PATTERNS) out = out.replace(re, '[redacted]')
    return out
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))

  if (typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(src)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? '[redacted]' : redact(v, depth + 1)
    }
    return out
  }
  return '[unprintable]'
}

const buffer: SberLogEntry[] = []
const MAX_BUFFER = 500

function emit(level: SberLogLevel, message: string, details?: Record<string, unknown>): void {
  const entry: SberLogEntry = {
    ts: new Date().toISOString(),
    level,
    message: String(redact(message)),
    details: details ? (redact(details) as Record<string, unknown>) : undefined
  }
  buffer.push(entry)
  if (buffer.length > MAX_BUFFER) buffer.shift()

  const line = `[sber-api][${entry.level}] ${entry.message}`
  if (level === 'ERROR') console.error(line, entry.details ?? '')
  else if (level === 'WARN') console.warn(line, entry.details ?? '')
  else console.log(line, entry.details ?? '')
}

export const sberLog = {
  info: (message: string, details?: Record<string, unknown>) => emit('INFO', message, details),
  warn: (message: string, details?: Record<string, unknown>) => emit('WARN', message, details),
  error: (message: string, details?: Record<string, unknown>) => emit('ERROR', message, details),
  /** Копия журнала для диагностики (уже очищенная от секретов). */
  recent: (limit = 100): SberLogEntry[] => buffer.slice(-limit)
}
