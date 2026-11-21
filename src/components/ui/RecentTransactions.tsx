import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/format'
import { useApp } from '@/lib/appStore'
import type { Transaction } from '@/lib/types'

export default function RecentTransactions({ transactions = [], onViewAll }: { transactions?: Transaction[]; onViewAll?: () => void }) {
  const { t, currency, locale } = useApp()
  const recentTxs = transactions.slice(0, 6)

  return (
    <div className="rounded-xl border border-border/70 bg-card/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-text">{t.recent}</div>
          <div className="text-xs text-muted">{t.recentSub}</div>
        </div>
        <button type="button" onClick={onViewAll} className="text-xs text-accent transition hover:underline">
          {t.viewAll}
        </button>
      </div>

      <div className="space-y-1">
        {recentTxs.length === 0 ? (
          <div className="text-center py-4 text-muted text-sm">Нет операций</div>
        ) : recentTxs.map((tx) => {
          const isIncome = tx.type === 'income'
          const displayName = tx.type === 'income' ? (tx.sender_name || tx.description) : (tx.recipient_name || tx.description)
          return (
            <div
              key={tx.id}
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition hover:bg-cardAlt/40"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${isIncome ? 'bg-accent/10 text-accent' : 'bg-border/50 text-muted'}`}>
                  {isIncome ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm text-text">{displayName || '—'}</div>
                  <div className="truncate text-[11px] text-muted">
                    {formatDate(tx.transaction_date, locale)}{tx.transaction_date.includes('T') ? `, ${tx.transaction_date.slice(11, 16)}` : ''} · {tx.description}
                  </div>
                </div>
              </div>
              <div className={`shrink-0 text-sm font-medium ${isIncome ? 'text-accent' : 'text-text/85'}`}>
                {isIncome ? '+' : '-'}{formatCurrency(tx.amount, currency, locale)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}