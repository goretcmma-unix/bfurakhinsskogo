import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { LayoutDashboard, ListChecks, FileText, Settings, ChevronLeft, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useApp } from '@/lib/appStore'
import FoundationLogoUrl from '@/images/fondlogotip.svg'

type Item = { id: string; icon: LucideIcon; label: string }

export default function Sidebar({
  active,
  collapsed,
  onSelect,
  onToggle
}: {
  active: string
  collapsed: boolean
  onSelect: (id: string) => void
  onToggle: () => void
}) {
  const { t } = useApp()
  const navRef = useRef<HTMLNavElement>(null)
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [indicator, setIndicator] = useState({ top: 0, height: 0 })

  useEffect(() => {
    const btn = buttonRefs.current.get(active)
    if (!btn || !navRef.current) return
    const navRect = navRef.current.getBoundingClientRect()
    const btnRect = btn.getBoundingClientRect()
    const lineHeight = btnRect.height * 0.65
    setIndicator({
      top: btnRect.top - navRect.top + (btnRect.height - lineHeight) / 4,
      height: lineHeight
    })
  }, [active])

  const items: Item[] = [
    { id: 'about', label: 'О фонде', icon: LayoutDashboard },
    { id: 'finance', label: 'Финансы', icon: ListChecks },
    { id: 'reports', label: 'Отчетность', icon: FileText },
    { id: 'impact', label: 'Влияние', icon: Settings }
  ]

  return (
    <motion.aside
      animate={{ width: collapsed ? 76 : 232 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="relative flex h-full shrink-0 flex-col border-r border-border bg-sidebar/80 backdrop-blur-md shadow-xl"
    >
      <div className="flex h-16 items-center gap-3 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent shadow-glow">
          <img src={FoundationLogoUrl} alt="" className="h-7 w-7" />
        </div>
        {!collapsed && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0">
            <div className="truncate pl-[2px] text-[10px] font-medium uppercase tracking-[0.22em] text-white/55">{t.foundation.replace(/^Фонд имени\s*/i, '') || t.foundation}</div>
            <div className="truncate text-sm font-semibold tracking-wide text-white">{t.console}</div>
          </motion.div>
        )}
      </div>

      <nav
        ref={navRef}
        className="flex-1 space-y-1 px-2 py-2 relative"
        aria-orientation="vertical"
      >
        {items.map(({ id, label, icon: Icon }) => {
          const isActive = active === id
          return (
            <button
              key={id}
              ref={(el) => { if (el) buttonRefs.current.set(id, el); else buttonRefs.current.delete(id) }}
              type="button"
              onClick={() => onSelect(id)}
              title={collapsed ? label : undefined}
              className={[
                'group relative flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors duration-200 ease-in-out',
                isActive ? 'text-accent active' : 'text-muted/70 hover:text-text/90'
              ].join(' ')}
            >
              <Icon size={18} strokeWidth={1.75} className={isActive ? 'text-accent/90' : 'text-muted/55 group-hover:text-muted/80'} />
              {!collapsed && <span className="relative truncate">{label}</span>}
            </button>
          )
        })}
        {!collapsed && (
          <motion.div
            className="absolute left-0 top-0 w-[3px] bg-accent rounded-full"
            animate={{ y: indicator.top, height: indicator.height }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
          />
        )}
      </nav>

      <div className="border-t border-border p-2">
        <button type="button" onClick={onToggle} className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-muted transition hover:bg-cardAlt/70 hover:text-text" aria-label={collapsed ? t.expand : t.collapse}>
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          {!collapsed && <span className="text-sm">{t.collapse}</span>}
        </button>
      </div>
    </motion.aside>
  )
}
