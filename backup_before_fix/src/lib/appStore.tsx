import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { dict, type Lang } from './i18n'

type Ctx = {
  lang: Lang
  setLang: (l: Lang) => void
  t: (typeof dict)['ru']
  currency: 'RUB' | 'USD'
  locale: string
}

const AppCtx = createContext<Ctx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const v = localStorage.getItem('cf_lang')
    return v === 'en' ? 'en' : 'ru'
  })

  const setLang = (l: Lang) => {
    setLangState(l)
    localStorage.setItem('cf_lang', l)
  }

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo<Ctx>(() => {
    const t = dict[lang] as (typeof dict)['ru']
    const currency = lang === 'ru' ? 'RUB' : 'USD'
    const locale = lang === 'ru' ? 'ru-RU' : 'en-US'
    return { lang, setLang, t, currency, locale }
  }, [lang])

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp() {
  const v = useContext(AppCtx)
  if (!v) throw new Error('useApp must be used within AppProvider')
  return v
}
