/**
 * Локальное состояние автосинхронизации: курсор (докуда дочитали выписку)
 * и журнал прогонов.
 *
 * Журнал хранится локально, а не только в Supabase: если БД недоступна,
 * причина сбоя всё равно должна остаться видимой пользователю.
 */

import { promises as fs } from 'fs'
import { join } from 'path'

export type SyncTrigger = 'auto' | 'manual' | 'startup' | 'reauth'
export type SyncStatus = 'running' | 'success' | 'partial' | 'failed'

export interface SyncCursor {
  /** Последняя дата, по которую выписка успешно прочитана (YYYY-MM-DD). */
  lastSyncedDate: string | null
  lastAttemptAt: string | null
  lastSuccessAt: string | null
}

export interface SyncJournalEntry {
  id: string
  trigger: SyncTrigger
  status: SyncStatus
  startedAt: string
  finishedAt: string | null
  fromDate: string | null
  toDate: string | null
  environment: string
  accountMasked: string | null
  daysRequested: number
  daysOk: number
  failedDates: Array<{ date: string; reason: string }>
  fetched: number
  unique: number
  incoming: number
  outgoing: number
  inserted: number
  duplicates: number
  rejected: number
  errorCode: string | null
  error: string | null
  dbRunId: string | null
  csvRows: number
}

const JOURNAL_LIMIT = 200

const EMPTY_CURSOR: SyncCursor = {
  lastSyncedDate: null,
  lastAttemptAt: null,
  lastSuccessAt: null
}

export class SyncStateStore {
  private readonly dir: string
  private journalCache: SyncJournalEntry[] | null = null

  constructor(userDataDir: string) {
    this.dir = join(userDataDir, 'sber-sync')
  }

  private get cursorPath(): string {
    return join(this.dir, 'state.json')
  }

  private get journalPath(): string {
    return join(this.dir, 'journal.json')
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 })
  }

  async loadCursor(): Promise<SyncCursor> {
    try {
      const text = await fs.readFile(this.cursorPath, 'utf8')
      const parsed = JSON.parse(text) as Partial<SyncCursor>
      return { ...EMPTY_CURSOR, ...parsed }
    } catch {
      return { ...EMPTY_CURSOR }
    }
  }

  async saveCursor(cursor: SyncCursor): Promise<void> {
    await this.ensureDir()
    await fs.writeFile(this.cursorPath, JSON.stringify(cursor, null, 2), { mode: 0o600 })
  }

  async journal(limit = 30): Promise<SyncJournalEntry[]> {
    if (!this.journalCache) {
      try {
        const text = await fs.readFile(this.journalPath, 'utf8')
        const parsed = JSON.parse(text) as SyncJournalEntry[]
        this.journalCache = Array.isArray(parsed) ? parsed : []
      } catch {
        this.journalCache = []
      }
    }
    return this.journalCache.slice(-limit).reverse()
  }

  async appendJournal(entry: SyncJournalEntry): Promise<void> {
    const current = await this.journal()
    const next = [...current].reverse().filter((e) => e.id !== entry.id)
    next.push(entry)
    const trimmed = next.slice(-JOURNAL_LIMIT)
    this.journalCache = trimmed
    await this.ensureDir()
    await fs.writeFile(this.journalPath, JSON.stringify(trimmed, null, 2), { mode: 0o600 })
  }
}

/**
 * Текущая дата в часовом поясе банка (Москва по умолчанию).
 * Выписка запрашивается по календарю банка, а не по зоне компьютера.
 */
export function bankToday(offsetMinutes: number): string {
  const shifted = new Date(Date.now() + offsetMinutes * 60_000)
  return shifted.toISOString().slice(0, 10)
}

/** Сдвиг даты YYYY-MM-DD на N дней. */
export function shiftIsoDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const base = Date.UTC(y, (m || 1) - 1, d || 1)
  return new Date(base + deltaDays * 86_400_000).toISOString().slice(0, 10)
}
