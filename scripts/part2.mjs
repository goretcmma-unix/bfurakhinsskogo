import fs from 'fs'

const part2 = `
export default function PublicPage() {
  const { t, currency, locale } = useApp()
  const [copied, setCopied] = useState(false)
  const [activePeriod, setActivePeriod] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  const copyLink = () => {
    navigator.clipboard?.writeText('https://charity-fond.ru/transparency')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-5 lg:px-12 bg-[#0B0D0D]/90 backdrop-blur sticky top-0 z-20">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/20 text-accent">
              <LeafIcon />
            </div>
            <div>
              <div className="text-lg font-black tracking-widest text-white uppercase">ФОНД</div>
              <div className="text-xs text-gray-400 font-medium">Фонд имени Алихажи Урахинского</div>
            </div>
          </div>
          <nav className="hidden items-center gap-8 text-sm font-medium text-gray-300 lg:flex">
            <span className="cursor-pointer text-accent border-b-2 border-accent pb-1">Главная</span>
            <span className="cursor-pointer hover:text-white transition">О фонде</span>
            <span className="cursor-pointer hover:text-white transition inline-flex items-center gap-1.5">
              Направления помощи <ChevronDown size={14} />
            </span>
            <span className="cursor-pointer hover:text-white transition">Финансовая отчётность</span>
            <span className="cursor-pointer hover:text-white transition">Контакты</span>
          </nav>
          <button
            type="button"
            onClick={() => alert('Спасибо за желание помочь фонду!')}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-xs font-bold text-[#0B0D0D] hover:bg-accent/90 transition shadow-lg shadow-accent/25"
          >
            <Heart size={15} className="fill-[#0B0D0D]" /> Помочь фонду
          </button>
        </header>

        <div className="relative overflow-hidden px-6 py-20 lg:px-12 lg:py-32 bg-gradient-to-r from-[#0B0D0D] via-[#0B0D0D]/90 to-transparent">
          <div className="absolute inset-0 z-0 opacity-30 mix-blend-overlay bg-cover bg-right" style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1532629345422-7515f3d16bb9?auto=format&fit=crop&q=80&w=1600")' }} />
          <div className="relative z-10 max-w-3xl space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full bg-accent/15 px-3.5 py-1.5 text-xs font-semibold text-accent border border-accent/30">
              <ShieldCheck size={15} /> Открытая отчётность
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-6xl lg:text-7xl leading-[1.08]">
              Помощь, которой можно доверять
            </h1>
            <p className="text-base sm:text-lg text-gray-300 leading-relaxed max-w-xl">
              Мы открыто публикуем финансовую отчётность и показываем, как ваши пожертвования помогают людям.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-4">
              <button
                type="button"
                onClick={() => alert('Переход к форме пожертвования')}
                className="inline-flex items-center gap-2.5 rounded-xl bg-accent px-7 py-3.5 text-sm font-bold text-[#0B0D0D] hover:bg-accent/90 transition shadow-xl shadow-accent/25"
              >
                Сделать пожертвование <ArrowUpRight size={18} />
              </button>
              <a
                href="#finances"
                className="inline-flex items-center gap-2.5 rounded-xl border border-white/20 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white hover:bg-white/10 transition backdrop-blur-md"
              >
                <Coins size={18} /> Смотреть отчётность
              </a>
            </div>
          </div>
        </div>
`

fs.appendFileSync('c:/Users/goret/OneDrive/Рабочий стол/Dashboard Charity/src/pages/PublicPage.tsx', part2, 'utf8');
console.log('Part 2 appended');
