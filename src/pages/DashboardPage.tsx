import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { ArrowUpRight, ArrowDownRight, Calendar, RefreshCw, AlertCircle, Upload } from 'lucide-react'
import OverviewChart, { type ChartView, type ChartDataPoint } from '@/components/charts/OverviewChart'
import StatCard from '@/components/ui/StatCard'
import RecentTransactions from '@/components/ui/RecentTransactions'
import { useApp } from '@/lib/appStore'
import { Select } from '@/components/ui/Select'
import { supabase, getCurrentFundId } from '@/lib/supabase'
import type { Transaction, TxType } from '@/lib/types'

type RangeKey = 'this_month' | 'months3' | 'months6' | 'this_year' | 'all'

export default function DashboardPage({ onNavigate, setInitialTxType }: { onNavigate?: (id: string) => void; setInitialTxType?: (t: TxType) => void }) {
  const { t, currency: appCurrency } = useApp()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [chartTransactions, setChartTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chartCurrency, setChartCurrency] = useState<string>('')
  const [availableCurrencies, setAvailableCurrencies] = useState<string[]>([])
  const loadDataRef = useRef<() => Promise<void>>()
  const channelRef = useRef<any>(null)

  const ranges = useMemo(
    () => [
      { value: 'this_month' as RangeKey, label: 'Этот месяц' },
      { value: 'months3' as RangeKey, label: 'Последние 3 месяца' },
      { value: 'months6' as RangeKey, label: 'Последние 6 месяцев' },
      { value: 'this_year' as RangeKey, label: 'Этот год' },
      { value: 'all' as RangeKey, label: 'Всё время' }
    ],
    []
  )
  const [range, setRange] = useState<RangeKey>('all')
  const [view, setView] = useState<ChartView>('months')
  const [drillMonth, setDrillMonth] = useState<string | null>(null)
  const rangeLabel = ranges.find((r) => r.value === range)?.label ?? ''

  const { startDate, endDate } = useMemo(() => {
    const now = new Date()
    const toIso = (d: Date) => d.toISOString().slice(0, 10)
    if (range === 'this_month') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1)
      return { startDate: toIso(from), endDate: toIso(now) }
    }
    if (range === 'months3') {
      const from = new Date(now.getFullYear(), now.getMonth() - 2, 1)
      return { startDate: toIso(from), endDate: toIso(now) }
    }
    if (range === 'months6') {
      const from = new Date(now.getFullYear(), now.getMonth() - 5, 1)
      return { startDate: toIso(from), endDate: toIso(now) }
    }
    if (range === 'this_year') {
      const from = new Date(now.getFullYear(), 0, 1)
      return { startDate: toIso(from), endDate: toIso(now) }
    }
    return { startDate: undefined, endDate: undefined } as { startDate?: string; endDate?: string }
  }, [range])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setChartTransactions([])
    try {
      const targetFundId = await getCurrentFundId().catch(() => undefined)
      if (!targetFundId) return

      const withRange = (q: any) => {
        q = q.eq('fund_id', targetFundId)
        if (startDate) q = q.gte('transaction_date', startDate)
        if (endDate) q = q.lte('transaction_date', endDate)
        return q
      }

      const { data: curData } = await withRange(supabase.from('transactions').select('currency'))
      const currencies = Array.from(
        new Set((curData || []).map((r: any) => r.currency).filter(Boolean))
      ).sort()
      setAvailableCurrencies(currencies)

      const preferred = (appCurrency || 'RUB').toUpperCase()
      const resolvedCurrency = currencies.includes(preferred) ? preferred : (currencies[0] ?? '')
      setChartCurrency(resolvedCurrency)

      if (!resolvedCurrency) {
        setTransactions([])
        setChartTransactions([])
        return
      }

      const { data: rows } = await withRange(supabase.from('transactions')
        .select('id,transaction_date,type,amount,currency')
        .order('transaction_date', { ascending: true }))
      setChartTransactions((rows || []) as Transaction[])

      const { data: recent } = await withRange(supabase.from('transactions')
        .select('id,transaction_date,type,amount,currency,sender_name,recipient_name,description')
        .order('transaction_date', { ascending: false })
        .limit(50))
      setTransactions((recent || []) as Transaction[])
    } catch (e) {
      console.error('Dashboard load error:', e)
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, appCurrency])

  loadDataRef.current = loadData

  useEffect(() => { void loadData() }, [startDate, endDate])

  // Realtime subscription - stable, not recreated on range change
  useEffect(() => {
    let active = true
    let timer: any
    ;(async () => {
      try {
        const fundId = await getCurrentFundId().catch(() => null)
        if (!active || !fundId) return
        channelRef.current = supabase
          .channel('dashboard-transactions')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `fund_id=eq.${fundId}` } as any, () => {
            clearTimeout(timer)
            timer = setTimeout(() => { void loadDataRef.current?.() }, 300)
          })
          .subscribe()
      } catch { /* ignore realtime setup errors */ }
    })()
    return () => {
      active = false
      clearTimeout(timer)
      if (channelRef.current) {
        try { supabase.removeChannel(channelRef.current) } catch { /* ignore */ }
      }
    }
  }, [])

  const summary = useMemo(() => {
    const filtered = chartTransactions.filter(tx => (tx.currency || 'RUB').toUpperCase() === chartCurrency)
    const income = filtered.filter((x) => x.type === 'income').reduce((s, x) => s + Number(x.amount || 0), 0)
    const expenses = filtered.filter((x) => x.type === 'expense').reduce((s, x) => s + Number(x.amount || 0), 0)
    return { balance: income - expenses, donations: income, expenses }
  }, [chartTransactions, chartCurrency])

  const parseTxDate = useCallback((v: any): Date | null => {
    if (!v) return null
    const s = String(v)
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d
  }, [])

  const chartData = useMemo(() => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const dayKeyFromDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const monthKeyFromDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`

    const filtered = chartTransactions.filter(tx => (tx.currency || 'RUB').toUpperCase() === chartCurrency)

    let buckets: { label: string; key: string }[] = []
    let keyOf: (tx: Transaction) => string | null

    if (range === 'this_month') {
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      buckets = Array.from({ length: daysInMonth }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth(), i + 1)
        return { label: d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }), key: dayKeyFromDate(d) }
      })
      keyOf = (tx) => { const d = parseTxDate(tx.transaction_date); return d ? dayKeyFromDate(d) : null }
    } else if (range === 'months3' || range === 'months6' || range === 'this_year') {
      let start = new Date(now.getFullYear(), now.getMonth() - 2, 1)
      let end = new Date(now.getFullYear(), now.getMonth(), 1)
      if (range === 'months6') start = new Date(now.getFullYear(), now.getMonth() - 5, 1)
      if (range === 'this_year') start = new Date(now.getFullYear(), 0, 1)
      const cur = new Date(start)
      while (cur <= end && buckets.length < 12) {
        buckets.push({ label: cur.toLocaleString('ru-RU', { month: 'short', year: '2-digit' }), key: monthKeyFromDate(cur) })
        cur.setMonth(cur.getMonth() + 1)
      }
      keyOf = (tx) => { const d = parseTxDate(tx.transaction_date); return d ? monthKeyFromDate(d) : null }
    } else {
      if (filtered.length === 0) return []
      let minD: Date | null = null, maxD: Date | null = null
      for (const tx of filtered) {
        const d = parseTxDate(tx.transaction_date); if (!d) continue
        if (!minD || d < minD) minD = d
        if (!maxD || d > maxD) maxD = d
      }
      if (!minD || !maxD) return []
      const start = new Date(minD.getFullYear(), minD.getMonth(), 1)
      const end = new Date(maxD.getFullYear(), maxD.getMonth(), 1)
      const cur = new Date(start)
      while (cur <= end && buckets.length < 120) {
        buckets.push({ label: cur.toLocaleString('ru-RU', { month: 'short', year: '2-digit' }), key: monthKeyFromDate(cur) })
        cur.setMonth(cur.getMonth() + 1)
      }
      keyOf = (tx) => { const d = parseTxDate(tx.transaction_date); return d ? monthKeyFromDate(d) : null }
    }

    const byKey = new Map<string, { donations: number; expenses: number }>()
    for (const b of buckets) byKey.set(b.key, { donations: 0, expenses: 0 })
    for (const tx of filtered) {
      const k = keyOf(tx)
      if (!k) continue
      const bucket = byKey.get(k)
      if (!bucket) continue
      const amt = Math.abs(Number(tx.amount || 0))
      if (!isFinite(amt)) continue
      if (tx.type === 'income') bucket.donations += amt
      else if (tx.type === 'expense') bucket.expenses += amt
    }

    return buckets.map(b => {
      const v = byKey.get(b.key) || { donations: 0, expenses: 0 }
      return { key: b.key, label: b.label, income: v.donations, expense: v.expenses, net: v.donations - v.expenses }
    })
  }, [chartTransactions, chartCurrency, range, parseTxDate])

  const actions = [
    { id: 'income', icon: ArrowUpRight, label: t.addIncome, variant: 'income' },
    { id: 'expense', icon: ArrowDownRight, label: t.addExpense, variant: 'expense' },
    { id: 'import', icon: Upload, label: t.importFile, variant: 'import' }
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-base font-semibold text-text">{t.dashboard}</div>
          <div className="flex items-center gap-2">
            <Select value={range} options={ranges} onChange={(v) => setRange(v as RangeKey)} ariaLabel={t.range} icon={<Calendar size={14} />} className="w-52" />
            {availableCurrencies.length > 1 && (
              <Select value={chartCurrency} options={availableCurrencies.map(c => ({ value: c, label: c }))} onChange={setChartCurrency} ariaLabel="Валюта" className="w-28" />
            )}
            <button onClick={loadData} disabled={loading} className="rounded-lg border border-border bg-card/80 p-2 text-muted hover:text-text transition disabled:opacity-40" title="Обновить">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <div className="text-xs text-muted">{t.quickActions}</div>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => {
            const Icon = a.icon
            const isIncome = a.variant === 'income'
            const isExpense = a.variant === 'expense'
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  if (a.variant === 'income' || a.variant === 'expense') {
                    setInitialTxType?.(a.variant)
                  }
                  onNavigate?.('finance')
                }}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                  isIncome
                    ? 'bg-accent/15 text-accent hover:bg-accent/20'
                    : isExpense
                    ? 'bg-red-500/15 text-red-400 hover:bg-red-500/20'
                    : 'bg-cardAlt/60 text-muted hover:bg-cardAlt/80 hover:text-text'
                }`}
              >
                <Icon size={16} />
                {a.label}
              </button>
            )
          })}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
          <button onClick={loadData} className="ml-auto text-red-400 hover:text-red-300 text-sm">Повторить</button>
        </div>
      )}

      <div className="grid w-full min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard index={0} label={t.totalBalance} value={summary.balance} change={t.netChange} positive={summary.balance >= 0} />
        <StatCard index={1} label={t.donationsReceived} value={summary.donations} change="+8%" positive />
        <StatCard index={2} label={t.totalExpenses} value={summary.expenses} change="+3%" positive={false} />
      </div>

      <div className="w-full min-w-0 relative">
        {loading && transactions.length > 0 && (
          <div className="absolute right-3 top-3 z-10 text-[11px] text-muted flex items-center gap-1.5">
            <RefreshCw size={12} className="animate-spin" /> Обновление…
          </div>
        )}
        <OverviewChart range={`${rangeLabel}${chartCurrency ? ` · ${chartCurrency}` : ''}`} balance={summary.balance} chartData={chartData} view="months" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <RecentTransactions transactions={transactions.slice(0, 20)} onViewAll={() => onNavigate?.('operations')} />
        </div>
        <div className="rounded-xl border border-border/70 bg-card/30 p-4">
          <div className="text-sm font-medium text-text">Данные загружены из базы</div>
          {loading && transactions.length === 0 && <div className="mt-2 text-xs text-muted">Загрузка данных...</div>}
          {loading && transactions.length > 0 && <div className="mt-2 text-xs text-muted">Обновление данных… (операций: {transactions.length.toLocaleString('ru-RU')})</div>}
          {!loading && <div className="mt-2 text-xs text-muted">Операций в периоде: {chartTransactions.length.toLocaleString('ru-RU')}</div>}
          {!loading && availableCurrencies.length > 1 && <div className="mt-1 text-xs text-muted">Валюты не суммируются: на графике показаны только операции в {chartCurrency || 'выбранной валюте'}.</div>}
          {!loading && chartTransactions.length === 0 && <div className="mt-1 text-xs text-muted">Нет операций за выбранный период{chartCurrency ? ` в валюте ${chartCurrency}` : ''}.</div>}
        </div>
      </div>
    </div>
  )
}