import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Check } from 'lucide-react'

export type Option<T extends string = string> = { value: T; label: string }

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
  icon
}: {
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
  ariaLabel?: string
  className?: string
  icon?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value) ?? options[0]

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl border border-border bg-card/80 px-3 py-2 text-sm text-text outline-none transition hover:border-accent/30 focus:border-accent/40"
      >
        {icon ? <span className="text-muted">{icon}</span> : null}
        <span className="min-w-0 flex-1 truncate text-left">{current?.label}</span>
        <ChevronDown size={15} className={`shrink-0 text-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence mode="wait">
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="absolute right-0 z-50 mt-1.5 max-h-60 min-w-full overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-card p-1 shadow-card"
          >
            {options.map((o) => {
              const active = o.value === value
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(o.value)
                      setOpen(false)
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                      active ? 'bg-accent/12 text-text' : 'text-muted hover:bg-cardAlt hover:text-text'
                    }`}
                  >
                    <span className="flex-1 truncate">{o.label}</span>
                    {active ? <Check size={14} className="text-accent" /> : null}
                  </button>
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
