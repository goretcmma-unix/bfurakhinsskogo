import { motion } from 'framer-motion'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { useApp } from '@/lib/appStore'
import { formatCurrency } from '@/lib/format'

export default function StatCard({
  label,
  value,
  hint,
  change,
  positive,
  index
}: {
  label: string
  value: number
  hint?: string
  change: string
  positive: boolean
  index: number
}) {
  const { currency, locale } = useApp()
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.2 }}
      className={`min-w-0 rounded-xl border bg-card/40 px-4 py-3 ${positive ? 'border-accent/20' : 'border-border/70'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted">{label}</div>
        <div className={`inline-flex items-center gap-0.5 text-[11px] ${positive ? 'text-accent' : 'text-muted'}`}>
          {positive ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
          {change}
        </div>
      </div>
      <div className="mt-1 break-words text-xl font-semibold tracking-tight text-text">{formatCurrency(value, currency, locale)}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-muted/80">{hint}</div> : null}
    </motion.div>
  )
}
