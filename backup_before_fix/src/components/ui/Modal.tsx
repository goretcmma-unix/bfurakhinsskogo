import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useApp } from '@/lib/appStore'

export function Modal({
  open,
  title,
  onClose,
  children,
  wide
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-start justify-center px-4 py-12"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
        >
          <button
            type="button"
            aria-label="close"
            className="absolute inset-0 bg-black/60"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className={`relative w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} max-h-[calc(100vh-96px)] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card shadow-card`}
            style={{ willChange: 'opacity' }}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="text-base font-semibold text-text">{title}</div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted transition hover:bg-cardAlt hover:text-text"
              >
                <X size={17} />
              </button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-xs text-muted">{label}</div>
      {children}
    </label>
  )
}

export const inputCls =
  'w-full rounded-xl border border-border bg-cardAlt/60 px-3 py-2.5 text-sm text-text outline-none transition placeholder:text-muted/70 focus:border-accent/40'

export function ModalActions({ onCancel, onSave, saveLabel }: { onCancel: () => void; onSave: () => void; saveLabel?: string }) {
  const { t } = useApp()
  return (
    <div className="mt-5 flex items-center justify-end gap-2">
      <button type="button" onClick={onCancel} className="rounded-xl border border-border bg-cardAlt/60 px-4 py-2 text-sm text-muted transition hover:text-text">
        {t.cancel}
      </button>
      <button type="button" onClick={onSave} className="rounded-xl border border-accent/30 bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20">
        {saveLabel ?? t.save}
      </button>
    </div>
  )
}
