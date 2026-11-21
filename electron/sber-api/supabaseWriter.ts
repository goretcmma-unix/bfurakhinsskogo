/**
 * Запись операций Sber API в Supabase (service_role, только main-процесс).
 *
 * Дедупликация двойная:
 *  1. приложение не отправляет уже известные externalId;
 *  2. БД отсекает повторы уникальным индексом (fund_id, bank_transaction_id).
 *
 * Существующие записи (CSV-импорт и ручной ввод) не удаляются и не изменяются:
 * upsert только добавляет отсутствующие пары.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sberLog } from './logger'

export interface UpsertStats {
  inserted: number
  duplicates: number
  updated: number
  /** externalId → id записи в БД (только для реально вставленных строк). */
  insertedIds: string[]
}

export interface SupabaseTarget {
  client: SupabaseClient
  fundId: string
  userId: string | null
  usingServiceRole: boolean
}

const BATCH_SIZE = 200

/** Клиент Supabase из переменных окружения (service_role предпочтителен). */
export function createAdminClient(): SupabaseClient | null {
  const url = (process.env.VITE_SUPABASE_URL ?? '').trim()
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  const anonKey = (process.env.VITE_SUPABASE_ANON_KEY ?? '').trim()
  const key = serviceKey || anonKey
  if (!url || !key) return null

  if (!serviceKey) {
    sberLog.warn('Supabase: используется anon-ключ (RLS может отклонить запись). Задайте SUPABASE_SERVICE_ROLE_KEY.')
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
}

/** Первый фонд + существующий user_id (поле transactions.user_id NOT NULL). */
export async function resolveTarget(client: SupabaseClient): Promise<SupabaseTarget | null> {
  const { data: fund, error: fundError } = await client
    .from('funds')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (fundError) {
    sberLog.error('Не удалось получить фонд из Supabase', { reason: fundError.message })
    return null
  }
  if (!fund) {
    sberLog.error('В Supabase нет ни одного фонда — синхронизация невозможна')
    return null
  }

  // transactions.user_id объявлен NOT NULL; берём уже существующего владельца записей,
  // чтобы не нарушать ограничение при серверной записи без сессии.
  const { data: owner } = await client
    .from('transactions')
    .select('user_id')
    .not('user_id', 'is', null)
    .limit(1)
    .maybeSingle()

  return {
    client,
    fundId: String(fund.id),
    userId: owner?.user_id ? String(owner.user_id) : null,
    usingServiceRole: Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim())
  }
}

/** Какие из externalId уже есть в БД. */
export async function findExistingIds(
  client: SupabaseClient,
  fundId: string,
  externalIds: string[]
): Promise<Set<string>> {
  const known = new Set<string>()
  if (!externalIds.length) return known

  const chunkSize = 500
  for (let i = 0; i < externalIds.length; i += chunkSize) {
    const chunk = externalIds.slice(i, i + chunkSize)
    const { data, error } = await client
      .from('transactions')
      .select('bank_transaction_id')
      .eq('fund_id', fundId)
      .in('bank_transaction_id', chunk)
    if (error) {
      sberLog.warn('Проверка существующих операций не удалась', {
        reason: error.message,
        fundId: fundId.slice(0, 8),
        chunkSize: chunk.length
      })
      continue
    }
    for (const row of data ?? []) {
      if (row.bank_transaction_id) known.add(String(row.bank_transaction_id))
    }
  }
  sberLog.info('Проверка дублей в БД перед вставкой', {
    checked: externalIds.length,
    alreadyKnown: known.size
  })
  return known
}

/**
 * Вставка новых операций.
 * `ignoreDuplicates: true` + уникальный индекс = повторный запуск безопасен.
 */
export async function upsertTransactions(
  target: SupabaseTarget,
  rows: Array<Record<string, unknown>>
): Promise<UpsertStats> {
  const stats: UpsertStats = { inserted: 0, duplicates: 0, updated: 0, insertedIds: [] }
  if (!rows.length) return stats

  const externalIds = rows
    .map((r) => String(r.bank_transaction_id ?? ''))
    .filter((id) => id.length > 0)
  const known = await findExistingIds(target.client, target.fundId, externalIds)

  const fresh = rows.filter((r) => !known.has(String(r.bank_transaction_id ?? '')))
  stats.duplicates += rows.length - fresh.length

  for (let i = 0; i < fresh.length; i += BATCH_SIZE) {
    const batch = fresh.slice(i, i + BATCH_SIZE).map((row) => {
      const payload: Record<string, unknown> = { ...row, fund_id: target.fundId }
      // Явный null недопустим для NOT NULL-поля — передаём владельца, если он известен.
      if (target.userId) payload.user_id = target.userId
      return payload
    })

    const { data, error } = await target.client
      .from('transactions')
      .upsert(batch, {
        onConflict: 'fund_id,bank_transaction_id',
        ignoreDuplicates: true
      })
      .select('id,bank_transaction_id')

    if (error) {
      sberLog.error('Не удалось записать операции в Supabase', {
        reason: error.message,
        details: (error as any).details ?? null,
        hint: (error as any).hint ?? null,
        code: (error as any).code ?? null,
        batch: batch.length
      })
      throw new Error(`Supabase insert failed: ${error.message}`)
    }

    const insertedRows = data ?? []
    stats.inserted += insertedRows.length
    stats.duplicates += batch.length - insertedRows.length
    for (const row of insertedRows) {
      if (row.bank_transaction_id) stats.insertedIds.push(String(row.bank_transaction_id))
    }
  }

  sberLog.info('Операции записаны в Supabase', {
    inserted: stats.inserted,
    duplicates: stats.duplicates,
    fund: target.fundId.slice(0, 8)
  })
  return stats
}

/** Открыть запись журнала прогона. Возвращает id или null, если журнал недоступен. */
export async function startSyncRun(
  client: SupabaseClient,
  fundId: string
): Promise<string | null> {
  const { data, error } = await client
    .from('sber_sync_runs')
    .insert({ fund_id: fundId, status: 'running' })
    .select('id')
    .maybeSingle()

  if (error) {
    sberLog.warn('Журнал прогонов недоступен (sber_sync_runs)', { reason: error.message })
    return null
  }
  return data?.id ? String(data.id) : null
}

export interface SyncRunFinish {
  status: 'success' | 'partial' | 'failed'
  fetched: number
  inserted: number
  duplicates: number
  error?: string | null
}

/** Закрыть запись журнала прогона. */
export async function finishSyncRun(
  client: SupabaseClient,
  runId: string,
  payload: SyncRunFinish
): Promise<void> {
  const dbStatus = payload.status === 'failed' ? 'failed' : 'success'
  const { error } = await client
    .from('sber_sync_runs')
    .update({
      finished_at: new Date().toISOString(),
      fetched: payload.fetched,
      inserted: payload.inserted,
      duplicates: payload.duplicates,
      status: dbStatus,
      error: payload.error ?? null
    })
    .eq('id', runId)

  if (error) {
    sberLog.warn('Не удалось обновить журнал прогонов', { reason: error.message })
  }
}
