import { useState } from 'react'
import { motion } from 'framer-motion'
import { Globe, Check } from 'lucide-react'
import { useApp } from '@/lib/appStore'
import { initialTransactions } from '@/lib/demoData'
import { formatCurrency } from '@/lib/format'

export default function PublicPage() {
  const { t, currency, locale } = useApp()
  const [msg, setMsg] = useState('')
  const income = initialTransactions.filter((x) => x.type === 'income')

  const save = () => { setMsg(t.published); setTimeout(() => setMsg(''), 1800) }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-base font-semibold text-text">{t.publicTitle}</div>
        <div className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t.publicSub}</div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-muted">{t.publicLink}</div>
            <div className="mt-0.5 text-sm text-text/80">https://<span className="text-muted">...</span>/transparency</div>
            <div className="mt-0.5 text-[11px] text-muted">{t.publicLinkHint}</div>
          </div>
          <button type="button" onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-accent/15 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/20">
            <Globe size={15} /> {t.publish}
          </button>
        </div>
        {msg && <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent/10 px-2.5 py-1.5 text-xs text-accent"><Check size={13} /> {msg}</div>}
        <div className="mt-3 text-[11px] text-muted">{t.transparencyNote}</div>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="overflow-hidden rounded-xl border border-border/70 bg-card/20">
        <div className="border-b border-border/60 px-4 py-3 text-sm font-medium text-text">{t.publicPreview}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead className="bg-cardAlt/40 text-left text-xs text-muted">
              <tr>
                <th className="border-b border-border/60 px-4 py-2.5 font-medium">{t.when}</th>
                <th className="border-b border-border/60 px-4 py-2.5 font-medium">{t.who}</th>
                <th className="border-b border-border/60 px-4 py-2.5 font-medium">{t.description}</th>
                <th className="border-b border-border/60 px-4 py-2.5 text-right font-medium">{t.howMuch}</th>
              </tr>
            </thead>
            <tbody>
              {income.map((r) => (
                <tr key={r.id}>
                  <td className="border-b border-border/50 px-4 py-2.5 text-muted">{r.date}{r.time ? ` ${r.time}` : ''}</td>
                  <td className="border-b border-border/50 px-4 py-2.5 text-text">{r.donor || '—'}</td>
                  <td className="border-b border-border/50 px-4 py-2.5 text-muted">{r.description}</td>
                  <td className="border-b border-border/50 px-4 py-2.5 text-right font-medium text-accent">{formatCurrency(r.amount, currency, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  )
}
