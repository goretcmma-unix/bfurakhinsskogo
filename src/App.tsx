import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Lenis from 'lenis'
import Sidebar from './components/layout/Sidebar'
import TopBar from './components/layout/TopBar'
import DashboardPage from './pages/DashboardPage'
import OperationsPage from './pages/OperationsPage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'
import SberTestPage from './pages/SberTestPage'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { useApp } from './lib/appStore'
import { initDatabase } from './lib/supabase'
import type { TxType } from './lib/types'

export default function App() {
  const { t } = useApp()
  const [active, setActive] = useState('about')
  const [collapsed, setCollapsed] = useState(false)
  const [initialTxType, setInitialTxType] = useState<TxType | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const lenisRef = useRef<Lenis | null>(null)

  useEffect(() => {
    initDatabase()
  }, [])

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const lenis = new Lenis({
      wrapper: el,
      content: el,
      lerp: 0.15,
      duration: 0.45,
      wheelMultiplier: 1.1,
      smoothWheel: true,
      syncTouch: false
    })
    lenisRef.current = lenis

    function raf(time: number) {
      lenis.raf(time)
      requestAnimationFrame(raf)
    }
    requestAnimationFrame(raf)

    return () => {
      lenis.destroy()
      lenisRef.current = null
    }
  }, [])

  const scrollToTop = useCallback(() => {
    lenisRef.current?.scrollTo(0, { immediate: false, duration: 0.4 })
  }, [])

  const title = useMemo(() => {
    const map: Record<string, string> = {
      about: 'О фонде',
      finance: 'Финансы',
      reports: 'Отчетность',
      impact: 'Влияние',
      'sber-test': 'Сбер API Тест'
    }
    return map[active] ?? 'О фонде'
  }, [active])

  const page = () => {
    switch (active) {
      case 'about': return <DashboardPage onNavigate={setActive} setInitialTxType={setInitialTxType} />
      case 'finance': return <OperationsPage initialTxType={initialTxType} setInitialTxType={setInitialTxType} />
      case 'reports': return <ReportsPage />
      case 'impact': return <SettingsPage />
      case 'sber-test': return <SberTestPage />
      default: return <DashboardPage onNavigate={setActive} />
    }
  }

  useEffect(() => {
    scrollToTop()
  }, [active, scrollToTop])

  return (
    <div className="h-screen w-screen overflow-hidden text-text">
      <div className="flex h-full">
        <Sidebar active={active} collapsed={collapsed} onSelect={setActive} onToggle={() => setCollapsed((v) => !v)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar title={title} />
          <main ref={mainRef} className="min-h-0 flex-1 overflow-auto p-5">
            <AnimatePresence mode="wait">
                <motion.div key={active} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="flex-1 min-h-0">
                <ErrorBoundary>
                  {page()}
                </ErrorBoundary>
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </div>
  )
}