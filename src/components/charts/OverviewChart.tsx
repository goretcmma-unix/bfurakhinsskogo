import { useId, useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { formatCurrency } from '@/lib/format'
import { useApp } from '@/lib/appStore'
import { ChevronLeft } from 'lucide-react'

export interface ChartDataPoint {
  key: string
  label: string
  income: number
  expense: number
  net: number
}

export type ChartView = 'months' | 'weeks' | 'days'

interface OverviewChartProps {
  range: string
  balance: number
  chartData: ChartDataPoint[]
  view: ChartView
  drillLabel?: string
  onViewChange?: (v: ChartView) => void
  onDrillDown?: (key: string, label: string) => void
  onDrillUp?: () => void
}

const INCOME_COLOR = '#40DED8'
const EXPENSE_COLOR = '#f87171'
const NEUTRAL = '#6b7572'
const GRID_COLOR = 'rgba(255,255,255,0.04)'
const AXIS_COLOR = 'rgba(255,255,255,0.08)'

const compactCurrency = (value: number, currency: string) => {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return (value / 1_000_000).toFixed(0) + 'M ' + currency
  if (abs >= 1_000) return (value / 1_000).toFixed(0) + 'K ' + currency
  return value.toFixed(0) + ' ' + currency
}

const XAxisLabels = ({ data, xScale, padding, innerHeight, stepX, tickCount, color, fontSize }: any) => (
  <g className="x-axis-labels" fontSize={fontSize} fontWeight={500} fill={color} fontFamily="inherit">
    {data.map((d: any, i: number) => {
      if (i % stepX !== 0 && tickCount !== data.length) return null
      return (
        <text key={i} x={xScale(i)} y={padding.top + innerHeight + 14} textAnchor="middle" dominantBaseline="hanging" className="text-[10px]">
          {d.label}
        </text>
      )
    })}
  </g>
)

const YAxisLabels = ({ domain, padding, innerHeight, tickCount, formatCurrency, currency, locale, color, fontSize, isMobile }: any) => (
  <g className="y-axis-labels" fontSize={fontSize} fontWeight={500} fill={color} fontFamily="inherit">
    {Array.from({ length: tickCount }).map((_, i) => {
      const value = domain[1] * (1 - i / (tickCount - 1))
      const y = padding.top + (i / (tickCount - 1)) * innerHeight
      const label = isMobile ? compactCurrency(value, currency) : formatCurrency(value, currency, locale)
      return (
        <text key={i} x={padding.left - 8} y={y} textAnchor="end" dominantBaseline="middle" className="text-[10px]">
          {label}
        </text>
      )
    })}
  </g>
)

const CustomTooltip = ({ data, x, y, t, currency, locale, formatCurrency, width }: any) => {
  const netValue = Number(data.net || 0)
  const netColor = netValue >= 0 ? '#40DED8' : '#f87171'
  const tooltipWidth = 220
  const left = Math.min(Math.max(x - tooltipWidth / 2, 16), width - tooltipWidth - 16)
  const top = Math.max(y - 140, 16)
  
  return (
    <div
      className="rounded-xl border border-white/10 bg-[#0b0f0e]/95 px-4 py-3 text-xs shadow-2xl backdrop-blur-sm border-l-4 border-accent pointer-events-none"
      style={{ left, top, position: 'absolute', width: tooltipWidth, zIndex: 50, pointerEvents: 'none' }}
    >
      <div className="mb-2 text-[11px] font-medium text-text">{data.label}</div>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-6">
          <span className="text-[10px] text-muted">{t.donationsLegend}</span>
          <span className="font-semibold tabular-nums text-accent">{formatCurrency(Number(data.income || 0), currency, locale)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-6">
          <span className="text-[10px] text-muted">{t.expensesLegend}</span>
          <span className="font-semibold tabular-nums text-red-400">{formatCurrency(Number(data.expense || 0), currency, locale)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-6 border-t border-white/5 pt-1.5">
          <span className="text-[10px] text-muted">{t.netChange}</span>
          <span className={`text-base font-bold tabular-nums ${netColor}`}>
            {netValue >= 0 ? '+' : ''}{formatCurrency(netValue, currency, locale)}
          </span>
        </div>
      </div>
    </div>
  )
}

const OverviewChart = ({ 
  range, 
  balance, 
  chartData, 
  view, 
  drillLabel, 
  onViewChange, 
  onDrillDown, 
  onDrillUp 
}: OverviewChartProps) => {
  const id = useId().replace(/:/g, '')
  const { t, currency, locale } = useApp()
  const svgRef = useRef<SVGSVGElement>(null)
  const rafRef = useRef<number>()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 })
  const pendingIndexRef = useRef<number | null>(null)
  const lastHoveredIndexRef = useRef<number | null>(null)
  const incomePathRef = useRef<SVGPathElement>(null)
  const expensePathRef = useRef<SVGPathElement>(null)
  const lastDataKeyRef = useRef<string | null>(null)
  
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (svgRef.current) {
        const rect = svgRef.current.getBoundingClientRect()
        setSvgSize({ width: rect.width, height: rect.height })
      }
    })
    if (svgRef.current) ro.observe(svgRef.current)
    return () => ro.disconnect()
  }, [])

  // Анимация отрисовки линий пером (stroke-dashoffset) при смене данных/периода
  useEffect(() => {
    const dataKey = JSON.stringify({ chartData, range, view })
    if (lastDataKeyRef.current === dataKey) return
    lastDataKeyRef.current = dataKey

    const draw = (ref: React.RefObject<SVGPathElement>) => {
      const path = ref.current
      if (!path) return
      const length = path.getTotalLength()
      if (length === 0) return
      path.style.transition = 'none'
      path.style.strokeDasharray = length.toString()
      path.style.strokeDashoffset = length.toString()
      // Форсируем перерисовку, чтобы transition применился к начальному состоянию
      path.getBoundingClientRect()
      path.style.transition = 'stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1)'
      path.style.strokeDashoffset = '0'
    }
    draw(incomePathRef)
    draw(expensePathRef)
  }, [chartData, range, view])

  const hasData = chartData.some(d => d.income > 0 || d.expense > 0)
  const totals = useMemo(() => 
    chartData.reduce((sum, d) => ({
      income: sum.income + d.income,
      expense: sum.expense + d.expense
    }), { income: 0, expense: 0 })
  , [chartData])
  
  const maxValue = useMemo(() => {
    if (!chartData.length) return 1
    const v = Math.max(0, ...chartData.flatMap(d => [d.income, d.expense]))
    return v === 0 ? 1 : v
  }, [chartData])
  
  const yDomain = useMemo(() => [0, maxValue * 1.18] as [number, number], [maxValue])
  
  const isDense = chartData.length > 30
  const isMobile = svgSize.width < 640
  const tickCount = isDense ? Math.max(4, Math.ceil(chartData.length / 6)) : Math.min(chartData.length, 6)
  const stepX = isDense ? Math.ceil(chartData.length / tickCount) : 1
  const mobileStepX = isMobile && chartData.length > 4 ? Math.max(1, Math.ceil(chartData.length / 4)) : stepX
  
  const padding = isMobile
    ? { top: 12, right: 12, bottom: 56, left: 72 }
    : { top: 20, right: 16, bottom: 40, left: 56 }
  const innerWidth = svgSize.width - padding.left - padding.right
  const innerHeight = svgSize.height - padding.top - padding.bottom
  
  const xScale = useCallback((i: number) => innerWidth === 0 ? 0 : padding.left + (i / Math.max(1, chartData.length - 1)) * innerWidth, [innerWidth, chartData.length])
  const yScale = useCallback((value: number) => innerHeight === 0 ? 0 : padding.top + innerHeight - (value / yDomain[1]) * innerHeight, [innerHeight, yDomain[1]])
  
  const incomePath = useMemo(() => {
    if (chartData.length < 2) return ''
    const points = chartData.map((d, i) => ({ x: xScale(i), y: yScale(d.income) }))
    return points
      .map((p, i) => {
        if (i === 0) return `M${p.x},${p.y}`
        const prev = points[i - 1]
        const cpX = (prev.x + p.x) / 2
        return `C${cpX},${prev.y} ${cpX},${p.y} ${p.x},${p.y}`
      })
      .join(' ')
  }, [chartData, xScale, yScale])
  
  const expensePath = useMemo(() => {
    if (chartData.length < 2) return ''
    const points = chartData.map((d, i) => ({ x: xScale(i), y: yScale(d.expense) }))
    return points
      .map((p, i) => {
        if (i === 0) return `M${p.x},${p.y}`
        const prev = points[i - 1]
        const cpX = (prev.x + p.x) / 2
        return `C${cpX},${prev.y} ${cpX},${p.y} ${p.x},${p.y}`
      })
      .join(' ')
  }, [chartData, xScale, yScale])
  
  const incomeAreaPath = useMemo(() => {
    if (!incomePath) return ''
    const baseY = yScale(0)
    return `${incomePath} L${xScale(chartData.length - 1)},${baseY} L${padding.left},${baseY} Z`
  }, [incomePath, chartData.length, xScale, yScale])
  
  const expenseAreaPath = useMemo(() => {
    if (!expensePath) return ''
    const baseY = yScale(0)
    return `${expensePath} L${xScale(chartData.length - 1)},${baseY} L${padding.left},${baseY} Z`
  }, [expensePath, chartData.length, xScale, yScale])

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || chartData.length === 0) return
    const rect = svgRef.current.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const relX = (mouseX - padding.left) / Math.max(1, innerWidth)
    const index = Math.round(Math.max(0, Math.min(chartData.length - 1, relX * (chartData.length - 1))))
    pendingIndexRef.current = index
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      if (pendingIndexRef.current !== null && pendingIndexRef.current !== lastHoveredIndexRef.current) {
        lastHoveredIndexRef.current = pendingIndexRef.current
        setHoveredIndex(pendingIndexRef.current)
      }
    })
  }, [chartData.length, innerWidth])

  const handleMouseLeave = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    pendingIndexRef.current = null
    lastHoveredIndexRef.current = null
    setHoveredIndex(null)
  }, [])

  const handleClick = useCallback(() => {
    if (hoveredIndex !== null && view === 'months' && onDrillDown) {
      const d = chartData[hoveredIndex]
      onDrillDown(d.key, d.label)
    }
  }, [hoveredIndex, view, onDrillDown, chartData])

  const gridLines = useMemo(() => {
    const lines: { x1: number; x2: number; y1: number; y2: number; key: string }[] = []
    for (let i = 0; i < 5; i++) {
      const y = padding.top + (i / 4) * innerHeight
      lines.push({ x1: padding.left, x2: padding.left + innerWidth, y1: y, y2: y, key: `h-${i}` })
    }
    for (let i = 0; i < Math.min(chartData.length, 12); i++) {
      const idx = i * mobileStepX
      if (idx >= chartData.length) break
      const x = xScale(idx)
      lines.push({ x1: x, x2: x, y1: padding.top, y2: padding.top + innerHeight, key: `v-${i}` })
    }
    return lines
  }, [chartData.length, innerWidth, innerHeight, padding, stepX, xScale])

  const xLabels = useMemo(() => 
    chartData.map((d, i) => {
      if (i % mobileStepX !== 0 && tickCount !== chartData.length) return null
      return { x: xScale(i), label: d.label, key: i }
    }).filter(Boolean),
  [chartData, mobileStepX, tickCount, xScale])

  const yLabels = useMemo(() => 
    Array.from({ length: tickCount }).map((_, i) => {
      const value = yDomain[1] * (1 - i / (tickCount - 1))
      const y = padding.top + (i / (tickCount - 1)) * innerHeight
      return { y, label: formatCurrency(value, currency, locale), key: i }
    }),
  [yDomain, innerHeight, padding, currency, locale])

  return (
    <div className="w-full min-w-0 rounded-xl border border-border bg-card/50 p-4 shadow-sm relative">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-text">
            <span>{t.financialOverview}</span>
            {drillLabel && (
              <button
                type="button"
                onClick={onDrillUp}
                className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-[11px] text-accent transition hover:bg-accent/25"
              >
                <ChevronLeft size={11} /> {drillLabel}
              </button>
            )}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums text-text">
              {formatCurrency(balance, currency, locale)}
            </span>
            <span className="text-xs text-muted">{range}</span>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="h-2 w-2 rounded-full shadow-[0_0_8px_rgba(64,222,216,0.8)]" style={{ background: INCOME_COLOR }} />
            <div className="flex flex-col">
              <span className="text-[10px] font-medium text-muted uppercase tracking-wider leading-none mb-1">{t.donationsLegend}</span>
              <span className="font-bold tabular-nums text-sm leading-none" style={{ color: INCOME_COLOR }}>
                {formatCurrency(totals.income, currency, locale)}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-2.5">
            <div className="h-2 w-2 rounded-full shadow-[0_0_8px_rgba(248,113,113,0.8)]" style={{ background: EXPENSE_COLOR }} />
            <div className="flex flex-col">
              <span className="text-[10px] font-medium text-muted uppercase tracking-wider leading-none mb-1">{t.expensesLegend}</span>
              <span className="font-bold tabular-nums text-sm leading-none text-red-400">
                {formatCurrency(totals.expense, currency, locale)}
              </span>
            </div>
          </div>
        </div>
      </div>
      
      <div className="relative h-[260px] md:h-[360px] w-full min-w-0">
        <svg
          ref={svgRef}
          className="w-full h-full"
          overflow="visible"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          style={{ cursor: view === 'months' && onDrillDown ? 'crosshair' : 'default' }}
        >
          
          
          <defs>
            <linearGradient id={`gradient-income-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={INCOME_COLOR} stopOpacity="0.25" />
              <stop offset="100%" stopColor={INCOME_COLOR} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`gradient-expense-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={EXPENSE_COLOR} stopOpacity="0.2" />
              <stop offset="100%" stopColor={EXPENSE_COLOR} stopOpacity="0" />
            </linearGradient>
            <filter id={`glow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>
          
          <rect x="0" y="0" width="100%" height="100%" fill="transparent" />
          
          <g stroke={GRID_COLOR} strokeWidth={0.5} strokeDasharray="2 4">
            {gridLines.map(l => (
              <line key={l.key} x1={l.x1} x2={l.x2} y1={l.y1} y2={l.y2} />
            ))}
          </g>
          
          <line 
            x1={padding.left} 
            x2={padding.left + innerWidth} 
            y1={yScale(0)} 
            y2={yScale(0)} 
            stroke={AXIS_COLOR} 
            strokeWidth={1} 
          />
          
          <path d={incomeAreaPath} fill={`url(#gradient-income-${id})`} />
          <path d={expenseAreaPath} fill={`url(#gradient-expense-${id})`} />
          
          <path
            ref={incomePathRef}
            d={incomePath}
            fill="none"
            stroke={INCOME_COLOR}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#glow-${id})`}
          />
          <path
            ref={expensePathRef}
            d={expensePath}
            fill="none"
            stroke={EXPENSE_COLOR}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#glow-${id})`}
          />
          
          
          
          {hoveredIndex !== null && (
            <line 
              x1={xScale(hoveredIndex)} 
              x2={xScale(hoveredIndex)} 
              y1={padding.top} 
              y2={padding.top + innerHeight} 
              stroke="rgba(255,255,255,0.15)" 
              strokeWidth={1} 
              strokeDasharray="4 4"
            />
          )}
          
          <XAxisLabels 
            data={chartData} 
            xScale={xScale} 
            padding={padding} 
            innerHeight={innerHeight}
            stepX={mobileStepX}
            tickCount={tickCount}
            color={NEUTRAL}
            fontSize={isMobile ? 9 : 10}
          />
          
          <YAxisLabels 
            domain={yDomain} 
            padding={padding} 
            innerHeight={innerHeight}
            tickCount={tickCount}
            formatCurrency={formatCurrency}
            currency={currency}
            locale={locale}
            color={NEUTRAL}
            fontSize={isMobile ? 9 : 10}
            isMobile={isMobile}
          />
        </svg>
        
        {hoveredIndex !== null && chartData[hoveredIndex] && (
          <CustomTooltip
            data={chartData[hoveredIndex]}
            x={xScale(hoveredIndex) + padding.left}
            y={Math.min(yScale(chartData[hoveredIndex].income), yScale(chartData[hoveredIndex].expense)) + padding.top - 10}
            t={t}
            currency={currency}
            locale={locale}
            formatCurrency={formatCurrency}
            width={svgSize.width}
          />
        )}
      </div>
    </div>
  )
}

export default OverviewChart
