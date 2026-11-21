export const formatCurrency = (value: number, currency: 'RUB' | 'USD', locale: string) =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(value)

export const formatCompact = (value: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(value)

export const formatDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(iso)
  )
