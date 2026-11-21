import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  DownloadCloud,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
  XCircle,
} from 'lucide-react'
import { supabase, getCurrentFundId } from '@/lib/supabase'
import { formatCurrency } from '@/lib/format'

type SyncStatus = {
  ok?: boolean
  status?: any
  error?: string
}

type DbTransaction = {
  id: string
  transaction_date: string
  amount: number
  currency: string | null
  type: 'income' | 'expense'
  description: string | null
  sender_name: string | null
  bank_transaction_id: string | null
  data_source: string | null
  created_at: string | null
}

type DbSyncRun = {
  id: string
  started_at: string
  finished_at: string | null
  fetched: number
  inserted: number
  duplicates: number
  status: string
  error: string | null
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('ru-RU')
}

function formatRelative(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const diffMs = Date.now() - d.getTime()
  const sec = Math.round(diffMs / 1000)
  if (sec < 10) return 'только что'
  if (sec < 60) return `${sec} сек назад`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} мин назад`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} ч назад`
  const days = Math.round(h / 24)
  return `${days} дн назад`
}

function formatCountdown(iso?: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = t - Date.now()
  if (diff <= 0) return 'скоро'
  const s = Math.ceil(diff / 1000)
  if (s < 60) return `через ${s} сек`
  const m = Math.ceil(s / 60)
  if (m < 60) return `через ${m} мин`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `через ${h} ч ${rm} мин`
}

function runStatusMeta(status?: string | null) {
  const s = (status || '').toLowerCase()
  if (s === 'success') return { label: 'Успешно', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', Icon: CheckCircle2 }
  if (s === 'partial') return { label: 'Частично', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30', Icon: AlertTriangle }
  if (s === 'failed' || s === 'error') return { label: 'Ошибка', cls: 'text-red-400 bg-red-500/10 border-red-500/30', Icon: XCircle }
  if (s === 'running') return { label: 'Выполняется', cls: 'text-sky-400 bg-sky-500/10 border-sky-500/30', Icon: Loader2 }
  return { label: status || 'Нет данных', cls: 'text-muted bg-cardAlt/40 border-border', Icon: Clock3 }
}

function Badge({ status }: { status?: string | null }) {
  const meta = runStatusMeta(status)
  const Icon = meta.Icon
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.cls}`}>
      <Icon size={14} className={status === 'running' ? 'animate-spin' : ''} />
      {meta.label}
    </span>
  )
}

function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  tone = 'default',
}: {
  title: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon: any
  tone?: 'default' | 'ok' | 'warn' | 'bad'
}) {
  const toneCls =
    tone === 'ok'
      ? 'border-emerald-500/30 bg-emerald-500/5'
      : tone === 'warn'
        ? 'border-amber-500/30 bg-amber-500/5'
        : tone === 'bad'
          ? 'border-red-500/30 bg-red-500/5'
          : 'border-border bg-card'
  return (
    <div className={`rounded-2xl border p-4 shadow-card ${toneCls}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted">{title}</div>
          <div className="mt-1 text-sm font-semibold text-text break-words">{value}</div>
        </div>
        <div className="rounded-xl border border-border/70 bg-cardAlt/40 p-2 text-muted">
          <Icon size={16} />
        </div>
      </div>
      {hint ? <div className="mt-2 text-xs text-muted leading-relaxed">{hint}</div> : null}
    </div>
  )
}

export default function SberTestPage() {
  const [logs, setLogs] = useState<string[]>([])
  const [actionStatus, setActionStatus] = useState('Готово')
  const [syncStatus, setSyncStatus] = useState<any>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [journal, setJournal] = useState<any[]>([])
  const [lastDbTx, setLastDbTx] = useState<DbTransaction | null>(null)
  const [recentDbTx, setRecentDbTx] = useState<DbTransaction[]>([])
  const [recentDbRuns, setRecentDbRuns] = useState<DbSyncRun[]>([])
  const [dbError, setDbError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [stageSyncResult, setStageSyncResult] = useState<string | null>(null)

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 200))
  }, [])

  const loadFromSupabase = useCallback(async () => {
    try {
      const fundId = await getCurrentFundId()

      const [lastRes, recentRes, runsRes] = await Promise.all([
        supabase
          .from('transactions')
          .select('id,transaction_date,amount,currency,type,description,sender_name,bank_transaction_id,data_source,created_at')
          .eq('fund_id', fundId)
          .eq('data_source', 'sber_api')
          .order('transaction_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('transactions')
          .select('id,transaction_date,amount,currency,type,description,sender_name,bank_transaction_id,data_source,created_at')
          .eq('fund_id', fundId)
          .eq('data_source', 'sber_api')
          .order('transaction_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(8),
        supabase
          .from('sber_sync_runs')
          .select('id,started_at,finished_at,fetched,inserted,duplicates,status,error')
          .eq('fund_id', fundId)
          .order('started_at', { ascending: false })
          .limit(8),
      ])

      if (lastRes.error) throw lastRes.error
      if (recentRes.error) throw recentRes.error
      // sber_sync_runs может отсутствовать/быть недоступна в старой схеме — не валим весь экран
      if (runsRes.error) {
        setRecentDbRuns([])
      } else {
        setRecentDbRuns((runsRes.data || []) as DbSyncRun[])
      }

      const last = (lastRes.data?.[0] || null) as DbTransaction | null
      setLastDbTx(last)
      setRecentDbTx((recentRes.data || []) as DbTransaction[])
      setDbError(null)
    } catch (e: any) {
      setDbError(e?.message || 'Не удалось загрузить данные из Supabase')
    }
  }, [])

  const loadSyncState = useCallback(async () => {
    if (!window.api?.sberSyncStatus && !window.api?.sberSyncJournal) {
      setStatusError('Методы статуса синхронизации недоступны в preload (нужна пересборка/перезапуск приложения).')
      return
    }
    try {
      const [statusRes, journalRes] = await Promise.all([
        window.api.sberSyncStatus ? window.api.sberSyncStatus() : Promise.resolve(null),
        window.api.sberSyncJournal ? window.api.sberSyncJournal(12) : Promise.resolve(null),
      ])

      if (statusRes?.ok && statusRes.status) {
        setSyncStatus(statusRes.status)
        setStatusError(null)
      } else if (statusRes?.error) {
        setStatusError(statusRes.error)
      } else if (statusRes && !statusRes.ok) {
        setStatusError('Не удалось получить статус синхронизации')
      }

      if (journalRes?.ok && Array.isArray(journalRes.entries)) {
        setJournal(journalRes.entries)
      } else if (Array.isArray(journalRes)) {
        // на случай прямого массива
        setJournal(journalRes)
      }
    } catch (e: any) {
      setStatusError(e?.message || 'Ошибка получения статуса синхронизации')
    }
  }, [])

  const refreshAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    await Promise.allSettled([loadSyncState(), loadFromSupabase()])
    if (!silent) setLoading(false)
  }, [loadFromSupabase, loadSyncState])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(() => void refreshAll(true), 5000)
    return () => clearInterval(t)
  }, [autoRefresh, refreshAll])

  const runTest = useCallback(async (testType: string) => {
    setActionStatus(`Выполняется: ${testType}...`)
    addLog(`Запуск: ${testType}`)
    try {
      if (!window.api) throw new Error('API приложения недоступен')

      if (testType === 'transactions') {
        const res = await window.api.sberSync()
        const r = res?.result
        if (r) {
          addLog(
            `Сбер API: получено ${r.fetched ?? 0}, новых входящих в стейдж ${r.incoming ?? 0}, исходящих ${r.outgoing ?? 0}, дубли ${r.duplicates ?? 0}, отброшено ${r.rejected ?? 0}`
          )
          setActionStatus('Транзакции получены в стейдж')
        } else {
          addLog(`Результат: ${JSON.stringify(res)}`)
          setActionStatus('Команда выполнена')
        }
        await refreshAll(true)
        return
      }

      if (testType === 'sync-now') {
        if (!window.api.sberSyncNow) throw new Error('sberSyncNow недоступен (нужна пересборка приложения)')
        const res = await window.api.sberSyncNow()
        const entry = res?.entry || res
        if (entry?.status || entry?.inserted !== undefined) {
          addLog(
            `Автосинк: статус=${entry.status ?? '—'}, получено=${entry.fetched ?? 0}, добавлено=${entry.inserted ?? 0}, дубли=${entry.duplicates ?? 0}, ошибок дат=${Array.isArray(entry.failedDates) ? entry.failedDates.length : 0}`
          )
        } else {
          addLog(`Результат sync-now: ${JSON.stringify(res)}`)
        }
        setActionStatus(entry?.status === 'failed' ? 'Синхронизация завершилась с ошибкой' : 'Синхронизация выполнена')
        await refreshAll(true)
        return
      }

      const result = await (window.api as any).invoke?.('sber:run-test', testType)
      if (!result) throw new Error('Универсальный invoke недоступен в preload')
      if (result.success) {
        addLog(`${testType}: OK`)
        setActionStatus('Проверка успешна')
      } else {
        addLog(`${testType}: ошибка — ${result.error}`)
        setActionStatus('Ошибка проверки')
      }
    } catch (e: any) {
      addLog(`Ошибка: ${e.message}`)
      setActionStatus('Ошибка')
    }
  }, [addLog, refreshAll])

  const syncStageToDb = useCallback(async () => {
    setActionStatus('Перенос стейджа в БД...')
    setStageSyncResult(null)
    addLog('Перенос операций стейджа в transactions...')
    if (!window.api) {
      setStageSyncResult('API приложения недоступен')
      setActionStatus('Ошибка')
      return
    }
    try {
      const res = await window.api.sberSyncToDb()
      if (res.ok) {
        const prepared = res.prepared ?? (Number(res.inserted || 0) + Number(res.duplicates || 0))
        const msg = `Подготовлено: ${prepared}, добавлено: ${res.inserted ?? 0}, дублей: ${res.duplicates ?? 0}`
        setStageSyncResult(msg)
        addLog(`Стейдж → БД: ${msg}`)
        setActionStatus('Стейдж синхронизирован')
      } else {
        setStageSyncResult(`Ошибка: ${res.error}`)
        addLog(`Ошибка стейджа → БД: ${res.error}`)
        setActionStatus('Ошибка')
      }
    } catch (e: any) {
      setStageSyncResult(`Ошибка: ${e.message}`)
      addLog(`Ошибка стейджа → БД: ${e.message}`)
      setActionStatus('Ошибка')
    } finally {
      await refreshAll(true)
    }
  }, [addLog, refreshAll])

  const lastRun = syncStatus?.lastRun || journal[0] || null
  const cursor = syncStatus?.cursor || null
  const token = syncStatus?.token || null
  const nextAutoRunAt = useMemo(() => {
    if (!syncStatus?.intervalMs || !lastRun?.finishedAt) return null
    const t = new Date(lastRun.finishedAt).getTime()
    if (Number.isNaN(t)) return null
    return new Date(t + Number(syncStatus.intervalMs)).toISOString()
  }, [syncStatus?.intervalMs, lastRun?.finishedAt])

  const dbFresh = useMemo(() => {
    const ref = lastDbTx?.created_at || lastDbTx?.transaction_date
    if (!ref) return false
    const t = new Date(ref).getTime()
    return !Number.isNaN(t) && Date.now() - t < 5 * 60 * 1000
  }, [lastDbTx])

  const lastRunOk = lastRun && ['success', 'partial'].includes(String(lastRun.status || '').toLowerCase())
  const hasRecentInsert = Number(lastRun?.inserted || 0) > 0

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text">Sber API — статус синхронизации</h1>
          <p className="mt-1 text-sm text-muted">
            Понятная сводка: что делает автосинк, когда был последний прогон, есть ли ошибки и действительно ли последняя операция из Сбера записана в Supabase.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoRefresh((v) => !v)}
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
              autoRefresh ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-border bg-cardAlt/40 text-muted hover:text-text'
            }`}
          >
            <Activity size={15} />
            Автообновление: {autoRefresh ? 'вкл (5с)' : 'выкл'}
          </button>
          <button
            type="button"
            onClick={() => void refreshAll()}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-text transition hover:bg-cardAlt/50"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Обновить
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Последняя операция Сбера в Supabase"
          value={
            lastDbTx
              ? `${lastDbTx.type === 'income' ? '+' : '−'}${formatCurrency(Number(lastDbTx.amount || 0), lastDbTx.currency || 'RUB', 'ru-RU')}`
              : 'Не найдено'
          }
          hint={
            lastDbTx ? (
              <>
                <div>Дата операции: <span className="text-text/90">{formatDateTime(lastDbTx.transaction_date)}</span></div>
                <div>Записано в БД: <span className="text-text/90">{formatDateTime(lastDbTx.created_at)} ({formatRelative(lastDbTx.created_at)})</span></div>
                <div className="truncate" title={lastDbTx.description || ''}>{lastDbTx.description || 'Без описания'}</div>
              </>
            ) : (
              'В таблице transactions пока нет записей с data_source = sber_api.'
            )
          }
          icon={Database}
          tone={lastDbTx ? (dbFresh ? 'ok' : 'default') : 'warn'}
        />

        <StatCard
          title="Последний прогон автосинка"
          value={lastRun ? <Badge status={lastRun.status} /> : 'Нет данных'}
          hint={
            lastRun ? (
              <>
                <div>Завершён: <span className="text-text/90">{formatDateTime(lastRun.finishedAt || lastRun.startedAt)} ({formatRelative(lastRun.finishedAt || lastRun.startedAt)})</span></div>
                <div>Окно: <span className="text-text/90">{lastRun.fromDate || '—'} → {lastRun.toDate || '—'}</span></div>
                <div>Получено/добавлено/дубли: <span className="text-text/90">{lastRun.fetched ?? 0} / {lastRun.inserted ?? 0} / {lastRun.duplicates ?? 0}</span></div>
              </>
            ) : (
              'Журнал прогонов ещё не загружен или пуст.'
            )
          }
          icon={lastRunOk ? CheckCircle2 : lastRun?.status === 'failed' ? XCircle : Activity}
          tone={lastRunOk ? 'ok' : lastRun?.status === 'failed' ? 'bad' : 'default'}
        />

        <StatCard
          title="Курсор и расписание"
          value={cursor?.lastSyncedDate ? `Курсор: ${cursor.lastSyncedDate}` : 'Курсор не установлен'}
          hint={
            <>
              <div>Интервал: <span className="text-text/90">{syncStatus?.intervalMs ? `${Math.round(syncStatus.intervalMs / 1000)} сек` : '—'}</span></div>
              <div>Следующий автопрогон (оценка): <span className="text-text/90">{nextAutoRunAt ? `${formatDateTime(nextAutoRunAt)} (${formatCountdown(nextAutoRunAt)})` : '—'}</span></div>
              <div>Режим/окружение: <span className="text-text/90">{syncStatus?.environment || '—'} / {syncStatus?.statementMode || '—'}</span></div>
            </>
          }
          icon={Clock3}
          tone={cursor?.lastSyncedDate ? 'default' : 'warn'}
        />

        <StatCard
          title="Токен и доступ"
          value={token?.accessValid ? 'Access token действителен' : token?.hasRefreshToken ? 'Будет обновлён по refresh' : token?.hasAccessToken ? 'Access token есть' : 'Нет токена'}
          hint={
            <>
              <div>Счёт: <span className="text-text/90">{syncStatus?.accountMasked || '—'}</span></div>
              <div>Access до: <span className="text-text/90">{formatDateTime(token?.accessExpiresAt)}</span></div>
              <div>Последний reject: <span className="text-text/90">{formatDateTime(token?.lastRejectedAt)}</span></div>
            </>
          }
          icon={ShieldCheck}
          tone={token?.accessValid || token?.hasRefreshToken ? 'ok' : 'warn'}
        />
      </div>

      {(statusError || dbError) && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100 space-y-1">
          {statusError ? <div><b>Статус синка:</b> {statusError}</div> : null}
          {dbError ? <div><b>Supabase:</b> {dbError}</div> : null}
          <div className="text-amber-200/80">Часть данных может быть недоступна (например, приложение не пересобрано после добавления IPC или нет доступа к таблице). Автообновление и таблицы ниже покажут то, что доступно.</div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-text">Последняя транзакция из Сбера в Supabase</h2>
              <p className="text-xs text-muted mt-1">Главный признак: запись с <code>data_source='sber_api'</code> есть в таблице <code>transactions</code>.</p>
            </div>
            {lastDbTx ? <Badge status={dbFresh ? 'success' : 'partial'} /> : <Badge status="failed" />}
          </div>

          {lastDbTx ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-cardAlt/30 p-3">
                <div className="text-xs text-muted">Дата и сумма операции</div>
                <div className="mt-1 text-lg font-semibold text-text">
                  {lastDbTx.type === 'income' ? '+' : '−'}{formatCurrency(Number(lastDbTx.amount || 0), lastDbTx.currency || 'RUB', 'ru-RU')}
                </div>
                <div className="text-sm text-text/90">{formatDateTime(lastDbTx.transaction_date)}</div>
              </div>
              <div className="rounded-xl border border-border/70 bg-cardAlt/30 p-3">
                <div className="text-xs text-muted">Запись в Supabase</div>
                <div className="mt-1 text-sm font-medium text-text">{formatDateTime(lastDbTx.created_at)}</div>
                <div className="text-xs text-muted">{formatRelative(lastDbTx.created_at)}</div>
                <div className="mt-1 text-xs text-muted">ID: <span className="font-mono text-text/80">{lastDbTx.id}</span></div>
              </div>
              <div className="rounded-xl border border-border/70 bg-cardAlt/30 p-3 sm:col-span-2">
                <div className="text-xs text-muted">Описание / отправитель</div>
                <div className="mt-1 text-sm text-text/90">{lastDbTx.description || '—'}</div>
                <div className="text-xs text-muted mt-1">{lastDbTx.sender_name || 'Отправитель не указан'}</div>
                <div className="mt-2 text-xs text-muted">Bank transaction ID</div>
                <div className="mt-0.5 font-mono text-xs text-text/80 break-all">{lastDbTx.bank_transaction_id || '—'}</div>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
              В Supabase не найдено ни одной транзакции с <code>data_source='sber_api'</code>. Это значит, что либо автосинк ещё не записал операции, либо запись не прошла (ошибка токена/БД/доступа). Смотрите «Последний прогон» и журнал ниже.
            </div>
          )}

          <div className="mt-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-medium text-text">Последние операции Sber API в Supabase</h3>
              <span className="text-xs text-muted">до 8 записей</span>
            </div>
            <div className="overflow-auto rounded-xl border border-border/70">
              <table className="w-full text-sm">
                <thead className="bg-cardAlt/40 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Дата операции</th>
                    <th className="px-3 py-2 text-left font-medium">Сумма</th>
                    <th className="px-3 py-2 text-left font-medium">Описание</th>
                    <th className="px-3 py-2 text-left font-medium">Записано</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDbTx.length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-muted">Нет записей</td></tr>
                  ) : recentDbTx.map((tx) => (
                    <tr key={tx.id} className="border-t border-border/50">
                      <td className="px-3 py-2 whitespace-nowrap text-text/90">{formatDateTime(tx.transaction_date)}</td>
                      <td className={`px-3 py-2 whitespace-nowrap font-medium ${tx.type === 'income' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {tx.type === 'income' ? '+' : '−'}{formatCurrency(Number(tx.amount || 0), tx.currency || 'RUB', 'ru-RU')}
                      </td>
                      <td className="px-3 py-2 text-text/90 min-w-[220px]">
                        <div className="line-clamp-2">{tx.description || '—'}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-muted truncate" title={tx.bank_transaction_id || ''}>{tx.bank_transaction_id || ''}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted">{formatRelative(tx.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-4">
          <div>
            <h2 className="text-base font-semibold text-text">Детали последнего прогона</h2>
            <p className="text-xs text-muted mt-1">Данные из локального синхронизатора (курсор/журнал). Если здесь «успешно» и inserted=0 — новых операций в банке не было, но связь и запись в БД работают.</p>
          </div>

          {lastRun ? (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2"><Badge status={lastRun.status} /> <span className="text-muted">запуск: {lastRun.trigger || '—'}</span></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-border/70 bg-cardAlt/30 p-3"><div className="text-xs text-muted">Старт</div><div className="text-text/90">{formatDateTime(lastRun.startedAt)}</div></div>
                <div className="rounded-xl border border-border/70 bg-cardAlt/30 p-3"><div className="text-xs text-muted">Финиш</div><div className="text-text/90">{formatDateTime(lastRun.finishedAt)}</div></div>
                <div className="rounded-xl border border-border/70 bg-cardAlt/30 p-3"><div className="text-xs text-muted">Получено из API</div><div className="text-text font-medium">{lastRun.fetched ?? 0}</div></div>
                <div className="rounded-xl border border-border/70 bg-cardAlt/30 p-3"><div className="text-xs text-muted">Добавлено в БД</div><div className={`font-medium ${Number(lastRun.inserted || 0) > 0 ? 'text-emerald-400' : 'text-text'}`}>{lastRun.inserted ?? 0}</div></div>
                <div className="rounded-xl border border-border/70 bg-cardAlt/30 p-3"><div className="text-xs text-muted">Дубли / уникальные</div><div className="text-text/90">{lastRun.duplicates ?? 0} / {lastRun.unique ?? '—'}</div></div>
                <div className="rounded-xl border border-border/70 bg-cardAlt/30 p-3"><div className="text-xs text-muted">Ошибки дат</div><div className={Array.isArray(lastRun.failedDates) && lastRun.failedDates.length ? 'text-amber-400 font-medium' : 'text-text/90'}>{Array.isArray(lastRun.failedDates) ? lastRun.failedDates.length : 0}</div></div>
              </div>
              {lastRun.error ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                  <div className="font-medium">Ошибка: {lastRun.errorCode || 'SYNC_FAILED'}</div>
                  <div className="mt-1 whitespace-pre-wrap break-words text-red-100/90">{lastRun.error}</div>
                </div>
              ) : null}
              {Array.isArray(lastRun.failedDates) && lastRun.failedDates.length > 0 ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                  <div className="font-medium mb-1">Даты с ошибками (будут повторены):</div>
                  {lastRun.failedDates.slice(0, 5).map((f: any, i: number) => (
                    <div key={i}>{f.date}: {f.reason}</div>
                  ))}
                </div>
              ) : null}
              <div className="text-xs text-muted">
                Подсказка: «добавлено 0, дубли &gt; 0» обычно означает, что операции уже есть в Supabase (это нормально). Новая операция считается записанной, когда появляется в блоке «Последняя транзакция из Сбера в Supabase».
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border/70 bg-cardAlt/30 p-4 text-sm text-muted">Статус последнего прогона недоступен.</div>
          )}

          <div className="border-t border-border/60 pt-4">
            <h3 className="text-sm font-medium text-text mb-2">Ручные действия (диагностика / стейдж)</h3>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => void runTest('sync-now')} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-emerald-500">
                <RefreshCw size={15} /> Запустить sync now
              </button>
              <button type="button" onClick={() => void runTest('transactions')} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-blue-500">
                <DownloadCloud size={15} /> Получить в стейдж
              </button>
              <button type="button" onClick={() => void runTest('config')} className="rounded-xl border border-border bg-cardAlt/40 px-3 py-2 text-sm text-text hover:bg-cardAlt/70">Проверить конфиг</button>
              <button type="button" onClick={() => void runTest('auth')} className="rounded-xl border border-border bg-cardAlt/40 px-3 py-2 text-sm text-text hover:bg-cardAlt/70">Проверить OAuth</button>
            </div>
            <button type="button" onClick={() => void syncStageToDb()} className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-purple-500">
              <UploadCloud size={15} /> Перенести стейдж в «Финансы» (transactions)
            </button>
            {stageSyncResult ? <div className="mt-2 rounded-xl border border-border/70 bg-cardAlt/30 p-3 text-sm text-text/90 whitespace-pre-wrap">{stageSyncResult}</div> : null}
            <div className="mt-2 text-xs text-muted">Текущее действие: <span className="text-text/80">{actionStatus}</span></div>
          </div>
        </motion.div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-base font-semibold text-text">Журнал автосинхронизации (локальный)</h2>
            <span className="text-xs text-muted">последние {journal.length || 0}</span>
          </div>
          <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
            {journal.length === 0 ? (
              <div className="text-sm text-muted">Журнал пуст или недоступен.</div>
            ) : journal.map((e: any) => (
              <div key={e.id || `${e.startedAt}-${e.trigger}`} className="rounded-xl border border-border/70 bg-cardAlt/25 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><Badge status={e.status} /><span className="text-xs text-muted">{e.trigger || '—'}</span></div>
                  <div className="text-xs text-muted">{formatDateTime(e.finishedAt || e.startedAt)} · {formatRelative(e.finishedAt || e.startedAt)}</div>
                </div>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div><span className="text-muted">Окно:</span> <span className="text-text/90">{e.fromDate || '—'}→{e.toDate || '—'}</span></div>
                  <div><span className="text-muted">Получено:</span> <span className="text-text/90">{e.fetched ?? 0}</span></div>
                  <div><span className="text-muted">Добавлено:</span> <span className={Number(e.inserted || 0) > 0 ? 'text-emerald-400 font-medium' : 'text-text/90'}>{e.inserted ?? 0}</span></div>
                  <div><span className="text-muted">Дубли:</span> <span className="text-text/90">{e.duplicates ?? 0}</span></div>
                </div>
                {e.error ? <div className="mt-2 text-xs text-red-300 break-words">{e.errorCode ? `${e.errorCode}: ` : ''}{e.error}</div> : null}
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-base font-semibold text-text">Прогоны в Supabase (sber_sync_runs)</h2>
            <span className="text-xs text-muted">общая БД-история</span>
          </div>
          <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
            {recentDbRuns.length === 0 ? (
              <div className="text-sm text-muted">Нет записей или таблица недоступна.</div>
            ) : recentDbRuns.map((r) => (
              <div key={r.id} className="rounded-xl border border-border/70 bg-cardAlt/25 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge status={r.status} />
                  <div className="text-xs text-muted">{formatDateTime(r.finished_at || r.started_at)} · {formatRelative(r.finished_at || r.started_at)}</div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div><span className="text-muted">Получено:</span> <span className="text-text/90">{r.fetched ?? 0}</span></div>
                  <div><span className="text-muted">Добавлено:</span> <span className={Number(r.inserted || 0) > 0 ? 'text-emerald-400 font-medium' : 'text-text/90'}>{r.inserted ?? 0}</span></div>
                  <div><span className="text-muted">Дубли:</span> <span className="text-text/90">{r.duplicates ?? 0}</span></div>
                </div>
                {r.error ? <div className="mt-2 text-xs text-red-300 break-words">{r.error}</div> : null}
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-base font-semibold text-text">События на этой странице</h2>
          <button type="button" onClick={() => setLogs([])} className="text-xs text-muted hover:text-text">Очистить</button>
        </div>
        <div className="bg-gray-950/70 text-green-400 p-4 rounded-xl h-56 overflow-y-auto font-mono text-xs border border-border/60">
          {logs.length === 0 ? <div className="text-muted">Пока пусто. Нажмите «Обновить» или запустите действие.</div> : logs.map((log, i) => <div key={i} className="whitespace-pre-wrap break-words">{log}</div>)}
        </div>
      </motion.div>
    </div>
  )
}
