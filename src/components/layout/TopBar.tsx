import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, Search, Languages } from 'lucide-react'
import { useApp } from '@/lib/appStore'

export default function TopBar({ title }: { title: string }) {
  const { t, lang, setLang } = useApp()
  const [notifOpen, setNotifOpen] = useState(false)
  const nRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (nRef.current && !nRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <header className="flex h-16 shrink-0 items-center border-b border-border bg-bg/70 px-5 backdrop-blur-md shadow-sm">
      <div className="flex-1 min-w-0 mr-3">
        <div className="text-[13px] font-medium text-muted">{t.foundation}</div>
        <div className="truncate text-lg font-semibold tracking-tight text-text">{title}</div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
        <div className="hidden items-center gap-2 rounded-xl border border-border bg-card/70 px-3 py-2 text-sm text-muted lg:flex shrink-0">
          <Search size={15} />
          <span className="w-40 text-left truncate">{t.search}</span>
        </div>

        <button
          type="button"
          onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
          className="inline-flex items-center gap-1.5 shrink-0 rounded-xl border border-border bg-card/70 px-2.5 py-2 text-xs font-medium text-muted transition hover:border-accent/30 hover:text-text"
          aria-label={t.language}
          title={t.language}
        >
          <Languages size={15} />
          <span className="hidden sm:inline shrink-0">{lang === 'ru' ? 'RU' : 'EN'}</span>
        </button>

        <div ref={nRef} className="relative shrink-0">
          <button type="button" onClick={() => setNotifOpen((v) => !v)} className="relative shrink-0 rounded-xl border border-border bg-card/70 p-2 text-muted transition hover:text-text" aria-label={t.notifications}>
            <Bell size={17} />
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent shadow-glow" />
          </button>
          <AnimatePresence mode="wait">
            {notifOpen && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute right-0 z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-border bg-card p-2 shadow-card">
                <div className="rounded-lg bg-cardAlt/60 px-3 py-2 text-xs text-muted">База подключена</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-2 shrink-0 rounded-xl border border-border bg-card/70 px-2.5 py-1.5 text-sm text-text">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-xs font-semibold text-accent">Д</span>
          <span className="hidden sm:inline shrink-0">{t.founder}</span>
        </div>
      </div>
    </header>
  )
}
