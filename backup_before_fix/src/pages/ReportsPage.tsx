import { useMemo, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileDown, Calendar, Filter, Download, BarChart2, PieChart, FileText, RefreshCw, Check, AlertCircle, X } from 'lucide-react'
import { useApp } from '@/lib/appStore'
import { formatCurrency, formatDate } from '@/lib/format'
import { Select } from '@/components/ui/Select'
import { getFullReport } from '@/lib/dataService'
import type { FullReport, ReportPeriod, MonthlyStat } from '@/lib/types'

type PeriodPreset = 'month' | 'quarter' | 'year' | 'all' | 'custom'

export default function ReportsPage() {
  const { t, currency, locale } = useApp()
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [report, setReport] = useState<FullReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [activeSection, setActiveSection] = useState<'summary' | 'income' | 'expenses' | 'monthly' | 'transactions'>('summary')

  const presets = [
    { value: 'month' as PeriodPreset, label: t.month },
    { value: 'quarter' as PeriodPreset, label: t.ranges.quarter },
    { value: 'year' as PeriodPreset, label: t.yearLabel },
    { value: 'all' as PeriodPreset, label: t.ranges.all },
    { value: 'custom' as PeriodPreset, label: 'Произвольный' },
  ]

  const getPeriod = (): ReportPeriod => {
    const now = new Date()
    let startDate: string
    let endDate: string = now.toISOString().slice(0, 10)

    switch (periodPreset) {
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
        break
      case 'quarter':
        const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
        startDate = quarterStart.toISOString().slice(0, 10)
        break
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10)
        break
      case 'all':
        startDate = '2020-01-01'
        break
      case 'custom':
        startDate = customStart || new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10)
        endDate = customEnd || now.toISOString().slice(0, 10)
        break
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    }

    return { startDate, endDate, label: presets.find(p => p.value === periodPreset)?.label || '' }
  }

  const generateReport = async () => {
    setLoading(true)
    setMsg('')
    try {
      const period = getPeriod()
      const data = await getFullReport(period)
      console.log('[ReportsPage] Report data:', data)
      setReport(data)
      if (data.transactions.length === 0) {
        setMsg('Нет операций за выбранный период')
      }
      setMsg('Отчёт сформирован')
      setTimeout(() => setMsg(''), 1800)
    } catch (e) {
      console.error('Report error:', e)
      setMsg('Ошибка при формировании отчёта')
    } finally {
      setLoading(false)
    }
  }

  const exportReport = () => {
    if (!report) return
    setMsg('Подготовка файла...')
    // Create CSV export
    const sections = [
      ['ПЕРИОД', report.period.label, report.period.startDate, report.period.endDate],
      [],
      ['СВОДКА', 'Значение'],
      ['Всего приходов', formatCurrency(report.summary.totalIncome, currency, locale)],
      ['Всего расходов', formatCurrency(report.summary.totalExpense, currency, locale)],
      ['Чистое изменение', formatCurrency(report.summary.netChange, currency, locale)],
      ['Остаток на начало', formatCurrency(report.summary.balanceStart, currency, locale)],
      ['Остаток на конец', formatCurrency(report.summary.balanceEnd, currency, locale)],
      [],
      ['ПРИХОДЫ ПО ИСТОЧНИКАМ', 'Сумма', 'Количество'],
      ...report.incomeBySource.map(r => [r.sourceType || 'Не указан', formatCurrency(r.totalAmount, currency, locale), r.count]),
      [],
      ['РАСХОДЫ ПО КАТЕГОРИЯМ', 'Сумма', 'Количество'],
      ...report.expensesByCategory.map(r => [r.categoryName, formatCurrency(r.totalAmount, currency, locale), r.count]),
      [],
      ['МЕСЯЧНАЯ СТАТИСТИКА', 'Приходы', 'Расходы', 'Чисто', 'Операций'],
      ...report.monthlyStats.map(r => [r.month, formatCurrency(r.income, currency, locale), formatCurrency(r.expense, currency, locale), formatCurrency(r.net, currency, locale), r.operations]),
      [],
      ['ОПЕРАЦИИ', 'Дата', 'Тип', 'Категория', 'Описание', 'Отправитель/Получатель', 'Сумма', 'Документ', 'Способ оплаты'],
      ...report.transactions.map(t => [
        formatDate(t.transaction_date, locale),
        t.type === 'income' ? 'Приход' : 'Расход',
        t.category?.name || '—',
        t.description,
        t.type === 'income' ? t.sender_name || '—' : t.recipient_name || '—',
        (t.type === 'income' ? '+' : '-') + formatCurrency(t.amount, currency, locale),
        t.document_status === 'attached' ? 'Есть' : t.document_status === 'expected' ? 'Ожидается' : 'Нет',
        t.payment_method || '—',
      ]),
    ]

    const csv = sections.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report-${report.period.startDate}-to-${report.period.endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setMsg('Файл скачан')
    setTimeout(() => setMsg(''), 1800)
  }

  // Auto-generate on mount and preset change
  useEffect(() => { generateReport() }, [periodPreset, customStart, customEnd])

  const periodLabel = periodPreset === 'custom'
    ? `${customStart || '—'} — ${customEnd || '—'}`
    : presets.find(p => p.value === periodPreset)?.label || ''

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-text">{t.reportByPeriod}</div>
          <div className="text-xs text-muted">{t.reportsSub}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={periodPreset} options={presets} onChange={setPeriodPreset} ariaLabel={t.period} icon={<Calendar size={14} />} className="w-44" />
          {periodPreset === 'custom' && (
            <>
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="rounded-xl border border-border bg-card/80 px-3 py-2 text-sm text-text outline-none w-36" />
              <span className="text-muted">—</span>
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="rounded-xl border border-border bg-card/80 px-3 py-2 text-sm text-text outline-none w-36" />
            </>
          )}
          <button type="button" onClick={generateReport} disabled={loading} className="rounded-xl border border-accent/30 bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-40">{loading ? 'Формирование...' : t.generate}</button>
          <button type="button" onClick={exportReport} disabled={!report || loading} className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/70 px-3 py-2 text-sm text-muted transition hover:text-text disabled:opacity-40"><FileDown size={15} /> {t.downloadReport}</button>
        </div>
      </div>

      {msg && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          className="rounded-xl border border-accent/20 bg-accent/10 px-3 py-2 text-sm text-accent"
        >
          {msg}
        </motion.div>
      )}

      {report && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: t.totalIncome, value: report.summary.totalIncome, positive: true, icon: '↑' },
              { label: t.totalOut, value: report.summary.totalExpense, positive: false, icon: '↓' },
              { label: 'Начальный остаток', value: report.summary.balanceStart, positive: report.summary.balanceStart >= 0, icon: '◀' },
              { label: 'Конечный остаток', value: report.summary.balanceEnd, positive: report.summary.balanceEnd >= 0, icon: '▶' },
              { label: t.balancePeriod, value: report.summary.netChange, positive: report.summary.netChange >= 0, icon: '⟳' },
            ].map((c, i) => (
              <motion.div key={c.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="rounded-2xl border border-border bg-card p-4 shadow-card">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted">{c.label}</div>
                  <span className={`text-xs ${c.positive ? 'text-accent' : 'text-red-400'}`}>{c.icon}</span>
                </div>
                <div className={`mt-2 text-2xl font-semibold ${c.positive ? 'text-accent' : 'text-text/85'}`}>{c.value >= 0 && c.label !== 'Всего расходов' ? '+' : ''}{formatCurrency(c.value, currency, locale)}</div>
              </motion.div>
            ))}
          </div>

          {/* Section Tabs */}
          <div className="flex flex-wrap gap-1 bg-card/50 rounded-xl p-1 mb-4" role="tablist">
            {[
              { id: 'summary', label: 'Сводка', icon: BarChart2 },
              { id: 'income', label: 'Приходы по источникам', icon: PieChart },
              { id: 'expenses', label: 'Расходы по категориям', icon: BarChart2 },
              { id: 'monthly', label: 'Месячная динамика', icon: BarChart2 },
              { id: 'transactions', label: 'Список операций', icon: FileText },
            ].map((tab) => {
              const Icon = tab.icon
              const isActive = activeSection === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveSection(tab.id as any)}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                    isActive ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text/90 hover:bg-cardAlt/50'
                  }`}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              )
            })}
          </div>

          <AnimatePresence>
            {/* SUMMARY */}
            {activeSection === 'summary' && (
              <motion.div key="summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                <motion.div className="rounded-2xl border border-border bg-card p-5 shadow-card">
                  <div className="text-sm font-medium text-text">Общая сводка за {periodLabel}</div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border/50 bg-cardAlt/30 p-4">
                      <div className="text-xs text-muted">Период</div>
                      <div className="font-medium text-text">{formatDate(report.period.startDate, locale)} — {formatDate(report.period.endDate, locale)}</div>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-cardAlt/30 p-4">
                      <div className="text-xs text-muted">Всего операций</div>
                      <div className="font-medium text-text">{report.transactions.length}</div>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-cardAlt/30 p-4">
                      <div className="text-xs text-muted">Приходов</div>
                      <div className="font-medium text-accent">{report.transactions.filter(t => t.type === 'income').length}</div>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-cardAlt/30 p-4">
                      <div className="text-xs text-muted">Расходов</div>
                      <div className="font-medium text-red-400">{report.transactions.filter(t => t.type === 'expense').length}</div>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-cardAlt/30 p-4 sm:col-span-2">
                      <div className="text-xs text-muted">С операцией прикреплён документ</div>
                      <div className="font-medium text-text">{report.transactions.filter(t => t.document_status === 'attached').length} из {report.transactions.length}</div>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-cardAlt/30 p-4 sm:col-span-2">
                      <div className="text-xs text-muted">Ожидают документ</div>
                      <div className="font-medium text-yellow-400">{report.transactions.filter(t => t.document_status === 'expected').length}</div>
                    </div>
                  </div>
                </motion.div>

                {/* Mini charts */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <motion.div className="rounded-2xl border border-border bg-card p-5 shadow-card">
                    <div className="text-sm font-medium text-text">Приходы по источникам</div>
                    <div className="mt-4 space-y-3">
                      {report.incomeBySource.length === 0 ? (
                        <div className="text-center py-6 text-muted">{t.noData}</div>
                      ) : report.incomeBySource.map((r) => (
                        <div key={r.sourceType || 'unknown'} className="flex items-center justify-between rounded-xl bg-cardAlt/40 px-3 py-2.5 text-sm">
                          <span className="text-muted">{SOURCE_TYPE_LABELS[r.sourceType || 'other']}</span>
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-accent">{formatCurrency(r.totalAmount, currency, locale)}</span>
                            <span className="text-xs text-muted">({r.count} операций)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>

                  <motion.div className="rounded-2xl border border-border bg-card p-5 shadow-card">
                    <div className="text-sm font-medium text-text">Расходы по категориям</div>
                    <div className="mt-4 space-y-3">
                      {report.expensesByCategory.length === 0 ? (
                        <div className="text-center py-6 text-muted">{t.noData}</div>
                      ) : report.expensesByCategory.map((r) => (
                        <div key={r.categoryName} className="flex items-center justify-between rounded-xl bg-cardAlt/40 px-3 py-2.5 text-sm">
                          <span className="text-muted">{r.categoryName}</span>
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-text/85">{formatCurrency(r.totalAmount, currency, locale)}</span>
                            <span className="text-xs text-muted">({r.count} операций)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            )}

            {/* INCOME BY SOURCE */}
            {activeSection === 'income' && (
              <motion.div key="income" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-2xl border border-border bg-card p-5 shadow-card">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm font-medium text-text">Приходы по источникам</div>
                  <span className="text-xs text-muted">{report.incomeBySource.reduce((s, r) => s + r.count, 0)} операций</span>
                </div>
                <div className="space-y-2">
                  {report.incomeBySource.length === 0 ? (
                    <div className="text-center py-6 text-muted">{t.noData}</div>
                  ) : report.incomeBySource.map((r) => (
                    <div key={r.sourceType || 'unknown'} className="flex items-center justify-between rounded-xl bg-cardAlt/40 px-4 py-3 text-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-blue-500/15 flex items-center justify-center">
                          <span className="text-blue-400 text-lg">{SOURCE_ICONS[r.sourceType || 'other']}</span>
                        </div>
                        <div>
                          <div className="font-medium text-text">{SOURCE_TYPE_LABELS[r.sourceType || 'other']}</div>
                          <div className="text-xs text-muted">{r.count} операций</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-accent">{formatCurrency(r.totalAmount, currency, locale)}</div>
                        <div className="text-xs text-muted">{((r.totalAmount / report.summary.totalIncome) * 100).toFixed(1)}%</div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* EXPENSES BY CATEGORY */}
            {activeSection === 'expenses' && (
              <motion.div key="expenses" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-2xl border border-border bg-card p-5 shadow-card">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm font-medium text-text">Расходы по категориям</div>
                  <span className="text-xs text-muted">{report.expensesByCategory.reduce((s, r) => s + r.count, 0)} операций</span>
                </div>
                <div className="space-y-2">
                  {report.expensesByCategory.length === 0 ? (
                    <div className="text-center py-6 text-muted">{t.noData}</div>
                  ) : report.expensesByCategory.map((r) => (
                    <div key={r.categoryName} className="flex items-center justify-between rounded-xl bg-cardAlt/40 px-4 py-3 text-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-red-500/15 flex items-center justify-center">
                          <span className="text-red-400 text-lg">📁</span>
                        </div>
                        <div>
                          <div className="font-medium text-text">{r.categoryName}</div>
                          <div className="text-xs text-muted">{r.count} операций</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-text/85">{formatCurrency(r.totalAmount, currency, locale)}</div>
                        <div className="text-xs text-muted">{((r.totalAmount / report.summary.totalExpense) * 100).toFixed(1)}%</div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* MONTHLY */}
            {activeSection === 'monthly' && (
              <motion.div key="monthly" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-2xl border border-border bg-card p-5 shadow-card">
<div className="text-sm font-medium text-text mb-4">Месячная динамика</div>
                 <div className="overflow-x-auto">
                   <table className="w-full min-w-[600px] text-sm table-fixed">
                     <colgroup>
                       <col style={{ width: '16%' }} />
                       <col style={{ width: '17%' }} />
                       <col style={{ width: '17%' }} />
                       <col style={{ width: '16%' }} />
                       <col style={{ width: '14%' }} />
                     </colgroup>
                     <thead className="bg-cardAlt/40 text-left text-xs text-muted">
                       <tr>
                         <th className="px-4 py-2 font-medium">Месяц</th>
                         <th colSpan={2} className="px-2 py-2 text-center font-medium border-b border-border/60">Движение средств</th>
                         <th className="px-4 py-2 text-right font-medium">Чисто</th>
                         <th className="px-4 py-2 text-right font-medium">Операций</th>
                       </tr>
                       <tr>
                         <th className="px-4 py-2 font-medium">Месяц</th>
                         <th className="px-4 py-2 text-right font-medium">Приходы</th>
                         <th className="px-4 py-2 text-right font-medium">Расходы</th>
                         <th className="px-4 py-2 text-right font-medium">Чисто</th>
                         <th className="px-4 py-2 text-right font-medium">Операций</th>
                       </tr>
                     </thead>
                     <tbody>
                       {report.monthlyStats.length === 0 ? (
                         <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">{t.noData}</td></tr>
                       ) : report.monthlyStats.map((m) => (
                         <tr key={m.month} className="border-t border-border/60">
                           <td className="px-4 py-2 text-muted">{m.month}</td>
                           <td className="px-4 py-2 text-right text-accent">{formatCurrency(m.income, currency, locale)}</td>
                           <td className="px-4 py-2 text-right text-text/85">{formatCurrency(m.expense, currency, locale)}</td>
                           <td className="px-4 py-2 text-right font-medium">{m.net >= 0 ? '+' : ''}{formatCurrency(m.net, currency, locale)}</td>
                           <td className="px-4 py-2 text-right text-muted">{m.operations}</td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
              </motion.div>
            )}

            {/* TRANSACTIONS */}
            {activeSection === 'transactions' && (
              <motion.div key="transactions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
                <div className="border-b border-border px-5 py-4 text-sm font-medium text-text">{t.opsTable}</div>
                <div className="max-h-[500px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card text-left text-xs text-muted">
                      <tr>
                        <th className="px-4 py-2 font-medium">{t.date}</th>
                        <th className="px-4 py-2 font-medium">{t.type}</th>
                        <th className="px-4 py-2 font-medium">{t.category}</th>
                        <th className="px-4 py-2 font-medium">{t.description}</th>
                        <th className="px-4 py-2 font-medium">{t.donor}</th>
                        <th className="px-4 py-2 font-medium">{t.source}</th>
                        <th className="px-4 py-2 font-medium">Документ</th>
                        <th className="px-4 py-2 text-right font-medium">{t.amount}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.transactions.length === 0 ? (
                        <tr><td colSpan={8} className="px-4 py-8 text-center text-muted">{t.empty}</td></tr>
                      ) : report.transactions.map((r) => (
                        <tr key={r.id} className="border-t border-border/60">
                          <td className="px-4 py-2 text-muted">{formatDate(r.transaction_date, locale)}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${r.type === 'income' ? 'bg-accent/15 text-accent' : 'bg-red-500/15 text-red-400'}`}>
                              {r.type === 'income' ? '↑' : '↓'} {r.type === 'income' ? t.incomeLabel : t.expenseLabel}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-muted">{r.category?.name || '—'}</td>
                          <td className="px-4 py-2 text-text/90 truncate max-w-xs">{r.description}</td>
                          <td className="px-4 py-2 text-muted">{r.type === 'income' ? r.sender_name || '—' : r.recipient_name || '—'}</td>
                          <td className="px-4 py-2 text-muted">{r.source_type ? SOURCE_TYPE_LABELS[r.source_type] : '—'}</td>
                          <td className="px-4 py-2 text-center">
                            {r.document_status === 'attached' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-green-500/15 text-green-400"><Check size={10} /> Есть</span>}
                            {r.document_status === 'expected' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-yellow-500/15 text-yellow-400"><AlertCircle size={10} /> Ожидается</span>}
                            {r.document_status === 'missing' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-gray-500/15 text-gray-400"><X size={10} /> Нет</span>}
                          </td>
                          <td className={`px-4 py-2 text-right ${r.type === 'income' ? 'text-accent' : 'text-text/85'}`}>{r.type === 'income' ? '+' : '-'}{formatCurrency(r.amount, currency, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  donation: 'Пожертвование',
  grant: 'Грант',
  corporate: 'Корпоративный взнос',
  event: 'Мероприятие',
  membership: 'Членские взносы',
  other: 'Другое',
  unknown: 'Не указан',
}

const SOURCE_ICONS: Record<string, string> = {
  donation: '💝',
  grant: '📜',
  corporate: '🏢',
  event: '🎪',
  membership: '👥',
  other: '📦',
  unknown: '❓',
}