import fs from 'fs'

const filePath = 'c:/Users/goret/OneDrive/Рабочий стол/Dashboard Charity/src/pages/PublicPage.tsx'

const part2 = `
export default function PublicPage() {
  const { t, currency, locale } = useApp()
  const [copied, setCopied] = useState(false)
  const [activePeriod, setActivePeriod] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [donationModalOpen, setDonationModalOpen] = useState(false)
  const [donationAmount, setDonationAmount] = useState('1000')

  const copyLink = () => {
    navigator.clipboard?.writeText('https://charity-fond.ru/transparency')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const openDonation = () => {
    setDonationAmount('1000')
    setDonationModalOpen(true)
  }

  const filteredTransactions = useMemo(() => {
    return publicTransactions.filter((tx) => {
      return (
        tx.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tx.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tx.doc.toLowerCase().includes(searchQuery.toLowerCase())
      )
    })
  }, [searchQuery])

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/40 p-4">
        <div>
          <div className="text-sm font-semibold text-text">{t.publicTitle}</div>
          <div className="mt-0.5 text-xs text-muted">{t.publicSub}</div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={copyLink}
            className="inline-flex items-center gap-2 rounded-lg bg-cardAlt px-3.5 py-2 text-xs font-medium text-text border border-border/80 hover:bg-cardAlt/80 transition"
          >
            {copied ? <Check size={14} className="text-accent" /> : <Globe size={14} />}
            {copied ? t.published : 'Скопировать ссылку сайта'}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-[#0B0D0D] text-white shadow-2xl font-sans">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-4 lg:px-10 bg-[#0B0D0D]/95 backdrop-blur sticky top-0 z-30">
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 text-accent">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.4 19 2c2 2 2.6 3.5 3.7 9.2a7 7 0 0 1-13.9 8.8Z" />
                <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.5 12 13 13 12" />
              </svg>
            </div>
            <div>
              <div className="text-base font-black tracking-wider text-white uppercase">ФОНД</div>
              <div className="text-[11px] text-gray-400 font-medium">Фонд имени Алихажи Урахинского</div>
            </div>
          </div>
          
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-300">
            <span className="cursor-pointer text-accent border-b-2 border-accent pb-1">Главная</span>
            <span className="cursor-pointer hover:text-white transition">О фонде</span>
            <span className="cursor-pointer hover:text-white transition inline-flex items-center gap-1">
              Направления помощи <ChevronDown size={14} />
            </span>
            <span className="cursor-pointer hover:text-white transition">Финансовая отчётность</span>
            <span className="cursor-pointer hover:text-white transition">Контакты</span>
          </nav>

          <button
            type="button"
            onClick={openDonation}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-xs font-bold text-[#0B0D0D] hover:bg-accent/90 transition shadow-lg shrink-0"
          >
            <Heart size={14} className="fill-[#0B0D0D]" /> Помочь фонду
          </button>
        </header>

        <div className="relative overflow-hidden px-6 py-16 lg:px-12 lg:py-24 bg-gradient-to-r from-[#0B0D0D] via-[#0B0D0D]/90 to-transparent">
          <div className="absolute inset-0 z-0 opacity-25 mix-blend-overlay bg-cover bg-right" style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1532629345422-7515f3d16bb9?auto=format&fit=crop&q=80&w=1600")' }} />
          <div className="relative z-10 max-w-2xl space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full bg-accent/15 px-3.5 py-1 text-xs font-semibold text-accent border border-accent/30">
              <ShieldCheck size={14} /> Открытая отчётность
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl leading-[1.1]">
              Помощь, которой можно доверять
            </h1>
            <p className="text-sm sm:text-base text-gray-300 leading-relaxed">
              Мы открыто публикуем финансовую отчётность и показываем, как ваши пожертвования помогают людям.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={openDonation}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-bold text-[#0B0D0D] hover:bg-accent/90 transition shadow-lg shadow-accent/25"
              >
                Сделать пожертвование <ArrowUpRight size={16} />
              </button>
              <a
                href="#finances"
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10 transition backdrop-blur-md"
              >
                <Coins size={16} /> Смотреть отчётность
              </a>
            </div>
          </div>
        </div>

      <Modal open={donationModalOpen} title="Пожертвование" onClose={() => setDonationModalOpen(false)} wide>
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-4">
            <QrCode size={56} className="text-accent" />
            <div className="text-sm text-muted">Отсканируйте QR-код для перевода</div>
          </div>
          <Field label="Сумма пожертвования">
            <input
              type="number"
              value={donationAmount}
              onChange={(e) => setDonationAmount(e.target.value)}
              className={inputCls}
              placeholder="1000"
            />
          </Field>
          <div className="rounded-xl border border-border bg-cardAlt/60 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Smartphone size={16} className="text-accent" />
              <span className="text-sm font-medium text-text">СБП / Телефон</span>
            </div>
            <div className="text-sm font-medium text-text">+7 (999) 000-00-00</div>
            <div className="text-xs text-muted mt-1">Перевод по номеру телефона через СБП</div>
          </div>
          <button
            type="button"
            onClick={() => { setDonationModalOpen(false); alert('Спасибо за пожертвование ' + donationAmount + ' ₽') }}
            className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-[#0B0D0D] hover:bg-accent/90 transition"
          >
            <Send size={16} /> Подтвердить пожертвование
          </button>
        </div>
      </Modal>
    </div>
  )
}
`

fs.appendFileSync(filePath, part2, 'utf8')
console.log('Part 2 appended')
