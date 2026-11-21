/**
 * CSV-история синхронизаций.
 *
 * Каждый прогон дописывает свои операции в месячный файл
 * <userData>/sber-history/sync-YYYY-MM.csv. Файлы только дополняются:
 * существующие строки никогда не перезаписываются, история накопительная.
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { sberLog } from './logger'
import type { PrivateTransaction } from './normalize'

const HEADER = [
  'sync_at',
  'period_from',
  'period_to',
  'operation_date',
  'direction',
  'amount',
  'currency',
  'bank_transaction_id',
  'counterparty',
  'purpose',
  'inserted'
] as const

/** Экранирование значения для CSV (RFC 4180, разделитель — точка с запятой). */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  if (/["\r\n;,]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(';')
}

export interface CsvHistoryResult {
  file: string
  rows: number
}

export interface CsvHistoryInput {
  syncAt: string
  fromDate: string
  toDate: string
  transactions: PrivateTransaction[]
  insertedIds: Set<string>
}

/** Дописать операции прогона в месячный CSV. */
export async function appendSyncHistory(
  userDataDir: string,
  input: CsvHistoryInput
): Promise<CsvHistoryResult | null> {
  if (!input.transactions.length) return null

  const dir = join(userDataDir, 'sber-history')
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })

  const byMonth = new Map<string, string[]>()
  for (const tx of input.transactions) {
    const month = (tx.operationDate || input.toDate).slice(0, 7)
    const line = csvRow([
      input.syncAt,
      input.fromDate,
      input.toDate,
      tx.operationDate,
      tx.direction,
      (tx.amountMinor / 100).toFixed(2),
      tx.currency,
      tx.externalId,
      tx.counterpartyName ?? '',
      tx.purpose ?? '',
      input.insertedIds.has(tx.externalId) ? 'yes' : 'no'
    ])
    const bucket = byMonth.get(month) ?? []
    bucket.push(line)
    byMonth.set(month, bucket)
  }

  let totalRows = 0
  let lastFile = ''
  for (const [month, lines] of byMonth) {
    const file = join(dir, `sync-${month}.csv`)
    let needHeader = true
    try {
      const stat = await fs.stat(file)
      needHeader = stat.size === 0
    } catch {
      needHeader = true
    }
    const payload = `${needHeader ? `${csvRow([...HEADER])}\n` : ''}${lines.join('\n')}\n`
    await fs.appendFile(file, payload, { mode: 0o600 })
    totalRows += lines.length
    lastFile = file
  }

  sberLog.info('История синхронизации дописана в CSV', { rows: totalRows, files: byMonth.size })
  return { file: lastFile, rows: totalRows }
}
