import { useState, type KeyboardEvent, type ChangeEvent } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

interface NumberInputProps {
  value: number | string
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
  className?: string
  disabled?: boolean
  error?: boolean
}

export function NumberInput({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  placeholder,
  className = '',
  disabled = false,
  error = false,
}: NumberInputProps) {
  const [displayValue, setDisplayValue] = useState<String>(String(value))

  const clamp = (val: number) => {
    let clamped = val
    if (min !== undefined) clamped = Math.max(min, clamped)
    if (max !== undefined) clamped = Math.min(max, clamped)
    return clamped
  }

  const roundToStep = (val: number) => {
    return Math.round(val / step) * step
  }

  const increment = (delta: number) => {
    const current = parseFloat(displayValue) || min
    const next = roundToStep(current + delta * step)
    const clamped = clamp(next)
    setDisplayValue(String(clamped))
    onChange(clamped)
  }

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    if (val === '' || val === '-' || val === '.') {
      setDisplayValue(val)
      return
    }
    const num = parseFloat(val)
    if (!isNaN(num)) {
      const clamped = clamp(roundToStep(num))
      setDisplayValue(String(clamped))
      onChange(clamped)
    }
  }

  const handleBlur = () => {
    const num = parseFloat(displayValue)
    if (!isNaN(num)) {
      const clamped = clamp(roundToStep(num))
      setDisplayValue(String(clamped))
      onChange(clamped)
    } else if (min !== undefined) {
      setDisplayValue(String(min))
      onChange(min)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      increment(1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      increment(-1)
    }
  }

  const inputClass = `
    w-full text-right bg-transparent border-0 outline-none
    ${error ? 'border-red-500/50' : ''}
    ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
    ${className}
  `.trim()

  return (
    <div className="relative flex items-stretch rounded-xl border border-border bg-cardAlt/50 transition hover:border-border/80">
      <input
        type="text"
        inputMode="decimal"
        value={displayValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={inputClass}
        disabled={disabled}
        autoComplete="off"
      />
      {!disabled && (
        <div className="flex flex-col justify-center items-center w-10 border-l border-border bg-card/50 px-1" aria-hidden="true">
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault()
              increment(1)
            }}
            className="flex w-full h-6 items-center justify-center text-muted hover:text-text hover:bg-accent/10 rounded-t transition"
            aria-label="Увеличить"
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault()
              increment(-1)
            }}
            className="flex w-full h-6 items-center justify-center text-muted hover:text-text hover:bg-accent/10 rounded-b transition"
            aria-label="Уменьшить"
          >
            <ChevronDown size={14} />
          </button>
        </div>
      )}
    </div>
  )
}