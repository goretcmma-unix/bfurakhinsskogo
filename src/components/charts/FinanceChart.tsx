import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Area
} from 'recharts'
import { Clock, Search } from 'lucide-react'
import { useApp } from '@/lib/appStore'
import { formatCurrency, formatCompact } from '@/lib/format'
import { getDailyStats } from '@/lib/dataService'
import type { DailyStat } from '@/lib/dataService'

type Timeframe = '1d' | '1w' | '1m' | '3m' | '6m' | '1y' | 'all'

const TIMEFRAMES: { value: Timeframe; label: string; days: number }[] = [
  { value: '1d', label: '1D', days: 1 },
  { value: '1w', label: '1W', days: 7 },
  { value: '1m', label: '1M', days: 30 },
  { value: '3m', label: '3M', days: 90 },
  { value: '6m', label: '6M', days: 180 },
  { value: '1y', label: '1Y', days: 365 },
  { value: 'all', label: 'Все', days: 0 }
]

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function formatDayShort(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`
}

interface FinanceChartProps {
  height?: number
  currency?: string
  locale?: string
}

const INCOME_COLOR = '#40E0D0'
const EXPENSE_COLOR = '#f87171'
const GRID_COLOR = 'rgba(255,255,255,0.04)'

export default function FinanceChart({ height = 420, currency = 'RUB', locale = 'ru-RU' }: FinanceChartProps) {
  const { t } = useApp()
  const [data, setData] = useState<DailyStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeframe, setTimeframe] = useState<Timeframe>('1m')
  const [brushStart, setBrushStart] = useState<number>(0)
  const [brushWidth, setBrushWidth] = useState<number>(100)
  const [dragStartClientX, setDragStartClientX] = useState<number | null>(null)
  const [dragStartBrushStart, setDragStartBrushStart] = useState<number>(0)
  const overviewRef = useRef<HTMLDivElement>(null)

  const startDateAndEndDate = useMemo(() => {
    const now = new Date()
    const toIso = (d: Date) => d.toISOString().slice(0, 10)
    switch (timeframe) {
      case '1d': return { startDate: toIso(now), endDate: toIso(now) }
      case '1w': return { startDate: toIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), endDate: toIso(now) }
      case '1m': return { startDate: toIso(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: toIso(now) }
      case '3m': return { startDate: toIso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), endDate: toIso(now) }
      case '6m': return { startDate: toIso(new Date(now.getFullYear(), now.getMonth() - 5, 1)), endDate: toIso(now) }
      case '1y': return { startDate: toIso(new Date(now.getFullYear() - 1, 0, 1)), endDate: toIso(now) }
      case 'all': return { startDate: undefined, endDate: undefined }
    }
  }, [timeframe])

  const startDate = startDateAndEndDate.startDate
  const endDate = startDateAndEndDate.endDate

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const rows = await getDailyStats(undefined, { startDate, endDate })
        if (active) setData(rows)
      } catch (e) {
        if (active) setError('Не удалось загрузить данные графика')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [startDate, endDate])

  useEffect(() => {
    if (data.length > 0) {
      setBrushStart(0)
      setBrushWidth(100)
    }
  }, [data])

  const visibleData = useMemo(() => {
    if (!data.length) return data
    const firstTs = new Date(data[0].date + 'T00:00:00').getTime()
    const lastTs = new Date(data[data.length - 1].date + 'T00:00:00').getTime()
    const span = lastTs - firstTs
    const startTs = firstTs + span * (brushStart / 100)
    const endTs = firstTs + span * ((brushStart + brushWidth) / 100)
    return data.filter(d => {
      const ts = new Date(d.date + 'T00:00:00').getTime()
      return ts >= startTs && ts <= endTs
    })
  }, [data, brushStart, brushWidth])

  const domain = useMemo(() => {
    if (!visibleData.length) return [0, 1] as [number, number]
    const vals = visibleData.flatMap(d => [d.income, d.expense])
    const max = Math.max(0, ...vals)
    const pad = max > 0 ? max * 0.12 : 1
    return [0, max + pad] as [number, number]
  }, [visibleData])

  const containerWidth = overviewRef.current?.clientWidth || 0

  const handleBrushMouseDown = useCallback((e: React.MouseEvent) => {
    setDragStartClientX(e.clientX)
    setDragStartBrushStart(brushStart)
  }, [brushStart])

  const handleBrushMouseMove = useCallback((e: MouseEvent) => {
    if (dragStartClientX === null || containerWidth <= 0) return
    const deltaX = e.clientX - dragStartClientX
    const deltaPct = (deltaX / containerWidth) * 100
    let newStart = dragStartBrushStart + deltaPct
    newStart = Math.max(0, Math.min(newStart, 100 - brushWidth))
    setBrushStart(newStart)
  }, [dragStartClientX, dragStartBrushStart, brushWidth, containerWidth])

  const handleBrushMouseUp = useCallback(() => {
    setDragStartClientX(null)
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', handleBrushMouseMove)
    window.addEventListener('mouseup', handleBrushMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleBrushMouseMove)
      window.removeEventListener('mouseup', handleBrushMouseUp)
    }
  }, [handleBrushMouseMove, handleBrushMouseUp])

  const tooltipContent = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const d = payload[0]?.payload
    if (!d) return null
    return (
      <div className="rounded-xl border border-white/10 bg-[#0b0f0e]/95 px-4 py-3 text-xs shadow-2xl backdrop-blur-md border-l-4 border-accent">
        <div className="text-[10px] font-medium text-gray-400 mb-1">{formatDayShort(d.date)}</div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-6 text-gray-300">
            <span className="text-[10px] text-gray-500">{t.donationsLegend}</span>
            <span className="font-semibold text-[#40E0D0]">{formatCurrency(d.income, currency as any, locale)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-6 text-gray-300">
            <span className="text-[10px] text-gray-500">{t.expensesLegend}</span>
            <span className="font-semibold text-[#f87171]">{formatCurrency(d.expense, currency as any, locale)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-1 pt-1 border-t border-white/5">
            <span className="text-[10px] text-gray-500">{t.netChange}</span>
            <span className={`font-bold ${d.net >= 0 ? 'text-[#40E0D0]' : 'text-[#f87171]'}`}>
              {d.net >= 0 ? '+' : ''}{formatCurrency(d.net, currency as any, locale)}
            </span>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-6 py-8 text-center text-sm text-red-400">
        {error}
        <button onClick={() => { setError(null); }} className="mt-3 text-accent underline underline-offset-4 hover:text-accent/80 text-sm">Повторить</button>
      </div>
    )
  }

  if (loading || data.length === 0) {
    return (
      <div className="rounded-xl border border-white/5 bg-[#0b0f0e] p-8 flex flex-col items-center justify-center h-full min-h-[400px]">
        <Clock size={28} className="mb-3 text-muted" />
        <div className="text-sm text-muted">{t.noData}</div>
      </div>
    )
  }

  const visibleFirst = visibleData[0]
  const visibleLast = visibleData[visibleData.length - 1]

  const totalIncome = visibleData.reduce((s, d) => s + d.income, 0)
  const totalExpense = visibleData.reduce((s, d) => s + d.expense, 0)
  const totalNet = totalIncome - totalExpense

  return (
    <div className="flex flex-col h-full min-h-0 rounded-xl border border-white/5 bg-[#0b0f0e] shadow-lg overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/5 bg-[#0b0f0e]/50 z-10">
        <div className="flex items-center gap-2 text-xs font-medium text-text">
          <span className="font-bold text-accent">Поступления / Расходы</span>
          <span className="text-gray-500">· {currency}</span>
        </div>
        <div className="flex items-center gap-1">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.value}
              type="button"
              onClick={() => setTimeframe(tf.value)}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition ${
                timeframe === tf.value
                  ? 'bg-accent/20 text-accent border border-accent/40'
                  : 'bg-white/5 text-gray-400 hover:text-text hover:bg-white/10'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
        <div className="ml-auto text-[10px] text-gray-500">
          {visibleFirst && visibleLast && (
            <>
              {formatDayShort(visibleFirst.date)} — {formatDayShort(visibleLast.date)}
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative w-full">
        <div className={`w-full h-[${height - 110}px]`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={visibleData}
              margin={{ top: 10, right: 20, left: 44, bottom: 28 }}
              layout="horizontal"
            >
              <defs>
                <linearGradient id="incomeAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={INCOME_COLOR} stopOpacity={0.25} />
                  <stop offset="50%" stopColor={INCOME_COLOR} stopOpacity={0.08} />
                  <stop offset="100%" stopColor={INCOME_COLOR} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="expenseAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={EXPENSE_COLOR} stopOpacity={0.18} />
                  <stop offset="50%" stopColor={EXPENSE_COLOR} stopOpacity={0.05} />
                  <stop offset="100%" stopColor={EXPENSE_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 2" stroke={GRID_COLOR} vertical={false} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />

              <XAxis
                dataKey="date"
                type="category"
                tick={{ fill: '#6b7572', fontSize: 10, fontWeight: 500 }}
                axisLine={false}
                tickLine={false}
                dy={6}
                minTickGap={40}
                interval={0}
                hide={visibleData.length > 60}
              />

              <YAxis
                domain={domain as any}
                tick={{ fill: '#6b7572', fontSize: 10, fontWeight: 500 }}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={(v) => formatCompact(v, locale)}
              />

              <Tooltip
                content={tooltipContent}
                cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1, strokeDasharray: '4 4' }}
                wrapperStyle={{ outline: 'none', pointerEvents: 'none' }}
                isAnimationActive={false}
              />

              <Area
                type="monotone"
                dataKey="income"
                fill="url(#incomeAreaGrad)"
                stroke={INCOME_COLOR}
                strokeWidth={2}
                fillOpacity={1}
                dot={false}
                activeDot={false}
              />
              <Area
                type="monotone"
                dataKey="expense"
                fill="url(#expenseAreaGrad)"
                stroke={EXPENSE_COLOR}
                strokeWidth={2}
                fillOpacity={1}
                dot={false}
                activeDot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div ref={overviewRef} className="absolute bottom-0 left-0 right-0 h-10 bg-[#0b0f0e]/80 border-t border-white/5 backdrop-blur-md p-1.5 flex items-end gap-2 z-20">
          <div className="flex-1 relative overflow-hidden rounded-lg border border-white/10 bg-[#080c0b] h-6 w-full">
            <svg className="absolute inset-0 w-full h-full block" width="100%" height="100%" onMouseDown={handleBrushMouseDown} style={{ cursor: 'ew-resize' }}>
              <defs>
                <linearGradient id="overviewGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#161e1d" />
                  <stop offset="100%" stopColor="#0f1514" />
                </linearGradient>
              </defs>
              <polyline
                fill="none"
                stroke="rgba(64, 224, 208, 0.35)"
                strokeWidth="1.5"
                points={data.map((d, i) => {
                  const x = data.length === 1 ? 50 : (i / (data.length - 1)) * 100
                  const maxVal = Math.max(...data.map(dd => Math.max(dd.income, dd.expense)))
                  const h = maxVal > 0 ? (Math.max(d.income, d.expense) / maxVal) * 40 : 0
                  return `${x},${44 - h}`
                }).join(' ')}
              />
              <rect
                x={brushStart}
                y={2}
                width={brushWidth}
                height={42}
                fill="rgba(64, 224, 208, 0.12)"
                stroke="#40E0D0"
                strokeWidth="1.5"
                rx="2"
                cursor="ew-resize"
              />
              <circle
                cx={brushStart}
                cy={23}
                r={5}
                fill="#40E0D0"
                stroke="#0b0f0e"
                strokeWidth="2"
                cursor="ew-resize"
              />
              <circle
                cx={brushStart + brushWidth}
                cy={23}
                r={5}
                fill="#40E0D0"
                stroke="#0b0f0e"
                strokeWidth="2"
                cursor="ew-resize"
              />
            </svg>
            <div className="absolute bottom-0 left-1 right-1 flex justify-between text-[9px] text-gray-600 pb-0.5 pointer-events-none">
              <span>{formatDayShort(data[0].date)}</span>
              <span>{formatDayShort(data[data.length - 1].date)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 ml-1 text-[10px] text-gray-500">
            <span className="text-xs font-medium text-text">Перетащите, чтобы выбрать период</span>
            <Search size={10} className="opacity-50" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-t border-white/5 bg-[#0a0d0c] text-xs">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#40E0D0]" />
          <span className="text-[#40E0D0] font-medium">{t.donationsLegend}</span>
          <span className="text-gray-500">{formatCurrency(totalIncome, currency as any, locale)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#f87171]" />
          <span className="text-[#f87171] font-medium">{t.expensesLegend}</span>
          <span className="text-gray-500">{formatCurrency(totalExpense, currency as any, locale)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
          <span className={`text-${totalNet >= 0 ? '#40E0D0' : '#f87171'} font-medium`}>{t.netChange}</span>
          <span className="text-gray-500">{formatCurrency(totalNet, currency as any, locale)}</span>
        </div>
      </div>
    </div>
  )
}