import * as React from 'react'
import { useState, type ReactNode, type ComponentType } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useApp } from '@/lib/appStore'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<
  { children: ReactNode; fallback?: ComponentType<{ error: Error; reset: () => void }> },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode; fallback?: ComponentType<{ error: Error; reset: () => void }> }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  reset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return <this.props.fallback error={this.state.error!} reset={this.reset} />
      }
      return <DefaultErrorFallback error={this.state.error!} reset={this.reset} />
    }
    return this.props.children
  }
}

function DefaultErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useApp()
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="flex h-full w-full items-center justify-center p-8 bg-bg"
    >
      <div className="max-w-md w-full text-center space-y-4">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-red-400">
          <AlertTriangle size={32} />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-text">Произошла ошибка</h2>
          <p className="text-sm text-muted">{error.message}</p>
        </div>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20"
        >
          <RefreshCw size={16} /> Попробовать снова
        </button>
      </div>
    </motion.div>
  )
}