export const formatCurrency = (value: number, currency: string = 'RUB', locale: string = 'ru-RU') =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency || 'RUB',
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
