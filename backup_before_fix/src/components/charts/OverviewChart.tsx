import { useId } from 'react'
import { motion } from 'framer-motion'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from 'recharts'
import { formatCompact, formatCurrency } from '@/lib/format'
import { useApp } from '@/lib/appStore'

interface ChartDataPoint {
  label: string
  donations: number
  expenses: number
  net: number
}

function TooltipContent({ active, payload, label, currency, locale, t }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="rounded-xl border border-accent/20 bg-card/95 px-3 py-2 text-xs shadow-glow backdrop-blur">
      <div className="mb-1 font-medium text-text">{label}</div>
      <div className="flex items-center justify-between gap-4 text-muted">
        <span>{t.donationsLegend}</span>
        <span className="text-accent">{formatCurrency(d.donations, currency, locale)}</span>
      </div>
      <div className="flex items-center justify-between gap-4 text-muted">
        <span>{t.expensesLegend}</span>
        <span className="text-text/80">{formatCurrency(d.expenses, currency, locale)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-4 border-t border-border pt-1 text-muted">
        <span>{t.net}</span>
        <span className="font-medium text-accent">{formatCurrency(d.net, currency, locale)}</span>
      </div>
    </div>
  )
}

export default function OverviewChart({ range, balance, chartData }: { range: string; balance: number; chartData: ChartDataPoint[] }) {
  const gradientId = `accentFill-${useId().replace(/:/g, '')}`
  const { t, currency, locale } = useApp()

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="w-full min-w-0 rounded-xl border border-border/70 bg-card/40 p-4"
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-text">{t.financialOverview}</div>
          <div className="mt-1 text-xs text-muted">{t.totalBalance}: {formatCurrency(balance, currency, locale)} · {range}</div>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent" />{t.donationsLegend}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accentMuted/70" />{t.expensesLegend}</span>
        </div>
      </div>

      <div className="h-[280px] w-full min-w-0 sm:h-[320px] xl:h-[380px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#40E0D0" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#40E0D0" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#252D2B" strokeDasharray="3 6" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#8B9693', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fill: '#8B9693', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={54}
              tickFormatter={(v) => formatCompact(v, locale)}
            />
            <Tooltip
              content={<TooltipContent currency={currency} locale={locale} t={t} />}
              cursor={{ stroke: '#2C8F85', strokeDasharray: '4 4' }}
              wrapperStyle={{ outline: 'none' }}
              isAnimationActive
              animationDuration={160}
            />
            <Area type="monotone" dataKey="donations" stroke="#40E0D0" strokeWidth={2.2} fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 4, fill: '#40E0D0', stroke: '#0B0D0D', strokeWidth: 2 }} isAnimationActive animationDuration={900} animationEasing="ease-out" />
            <Area type="monotone" dataKey="expenses" stroke="#2C8F85" strokeOpacity={0.75} strokeWidth={1.6} fill="transparent" dot={false} activeDot={{ r: 3, fill: '#2C8F85', stroke: '#0B0D0D', strokeWidth: 2 }} isAnimationActive animationDuration={900} animationEasing="ease-out" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  )
}