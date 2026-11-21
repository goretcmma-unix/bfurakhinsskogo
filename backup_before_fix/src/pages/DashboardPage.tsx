import { useMemo, useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Plus, Upload, ArrowUpRight, ArrowDownRight, Calendar, RefreshCw, AlertCircle } from 'lucide-react'
import OverviewChart from '@/components/charts/OverviewChart'
import StatCard from '@/components/ui/StatCard'
import RecentTransactions from '@/components/ui/RecentTransactions'
import { useApp } from '@/lib/appStore'
import { Select } from '@/components/ui/Select'
import { getTransactions, getCategories, getFunds } from '@/lib/dataService'
import type { Transaction, TxType } from '@/lib/types'
import { formatCurrency, formatDate } from '@/lib/format'

export default function DashboardPage({ onNavigate, setInitialTxType }: { onNavigate?: (id: string) => void; setInitialTxType?: (t: TxType) => void }) {
  const { t, currency, locale } = useApp()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const ranges = useMemo(
    () => [
      { value: 'days30', label: t.ranges.days30 },
      { value: 'quarter', label: t.ranges.quarter },
      { value: 'year', label: t.yearLabel },
      { value: 'all', label: t.ranges.all }
    ],
    [t]
  )
  const [range, setRange] = useState('year')
  const rangeLabel = ranges.find((r) => r.value === range)?.label ?? ''

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [txns] = await Promise.all([
        getTransactions(undefined, { limit: 100 }),
        getCategories(),
        getFunds(),
      ])
      setTransactions(txns.data)
    } catch (e) {
      console.error('Dashboard load error:', e)
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const filtered = useMemo(() => {
    const now = new Date()
    return transactions.filter((tx) => {
      const txDate = new Date(tx.transaction_date)
      if (range === 'days30') {
        const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)
        return txDate >= thirtyDaysAgo
      }
      if (range === 'quarter') {
        const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
        return txDate >= quarterStart
      }
      if (range === 'year') {
        return txDate.getFullYear() === now.getFullYear()
      }
      return true
    })
  }, [transactions, range])

  const summary = useMemo(() => {
    const income = filtered.filter((x) => x.type === 'income').reduce((s, x) => s + x.amount, 0)
    const expenses = filtered.filter((x) => x.type === 'expense').reduce((s, x) => s + x.amount, 0)
    return { balance: income - expenses, donations: income, expenses }
  }, [filtered])

  const chartData = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
      return { label: d.toLocaleString('ru-RU', { month: 'short' }), monthEn: d.toLocaleString('en-US', { month: 'short' }), start: d.toISOString().slice(0, 7) }
    })
    return months.map(m => {
      const monthTxs = filtered.filter(t => t.transaction_date.startsWith(m.start))
      const donations = monthTxs.filter(x => x.type === 'income').reduce((s, x) => s + x.amount, 0)
      const expenses = monthTxs.filter(x => x.type === 'expense').reduce((s, x) => s + x.amount, 0)
      return { label: m.label, donations, expenses, net: donations - expenses }
    })
  }, [filtered, range])

  const actions = [
    { id: 'income', icon: ArrowUpRight, label: t.addIncome, variant: 'income' },
    { id: 'expense', icon: ArrowDownRight, label: t.addExpense, variant: 'expense' },
    { id: 'import', icon: Upload, label: t.importFile, variant: 'import' }
  ]

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-3 border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-base font-semibold text-text">{t.dashboard}</div>
          <div className="flex items-center gap-2">
            <Select value={range} options={ranges} onChange={setRange} ariaLabel={t.range} icon={<Calendar size={14} />} className="w-44" />
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
      </motion.div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
          <button onClick={loadData} className="ml-auto text-red-400 hover:text-red-300 text-sm">Повторить</button>
        </div>
      )}

      <div className="grid w-full min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          index={0}
          label={t.totalBalance}
          value={summary.balance}
          change={t.netChange}
          positive={summary.balance >= 0}
        />
        <StatCard
          index={1}
          label={t.donationsReceived}
          value={summary.donations}
          change="+8%"
          positive
        />
        <StatCard
          index={2}
          label={t.totalExpenses}
          value={summary.expenses}
          change="+3%"
          positive={false}
        />
      </div>

      <div className="w-full min-w-0">
        <OverviewChart range={rangeLabel} balance={summary.balance} chartData={chartData} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <RecentTransactions transactions={filtered} onViewAll={() => onNavigate?.('operations')} />
        </div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="rounded-xl border border-border/70 bg-card/30 p-4">
          <div className="text-sm font-medium text-text">Данные загружены из Supabase</div>
          {loading && <div className="mt-2 text-xs text-muted">Загрузка данных...</div>}
        </motion.div>
      </div>
    </div>
  )
}