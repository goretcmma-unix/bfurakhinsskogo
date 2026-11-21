import fs from 'fs'

const part3a = `
        <div id="finances" className="border-t border-white/10 bg-[#121615] px-6 py-12 lg:px-12 space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 text-accent">
                <Coins size={22} />
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-white">Финансы фонда</h2>
                <p className="text-xs text-gray-400">Прозрачные данные в реальном времени</p>
              </div>
            </div>

            <div className="flex items-center gap-1 rounded-xl bg-black/50 p-1.5 border border-white/10 text-xs">
              {[
                { id: 'month', label: 'За месяц' },
                { id: 'quarter', label: 'За квартал' },
                { id: 'year', label: 'За год' },
                { id: 'all', label: 'За всё время' }
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActivePeriod(p.id)}
                  className={\`rounded-lg px-4 py-2 font-semibold transition \${
                    activePeriod === p.id
                      ? 'bg-accent text-[#0B0D0D] shadow'
                      : 'text-gray-400 hover:text-white'
                  }\`}
                >
                  {p.label}
                </button>
              ))}
              <div className="ml-2 pl-2 border-l border-white/10 text-gray-400 pr-2">
                <Calendar size={16} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
                  <Coins size={22} />
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-bold text-accent">
                  ↑ +12%
                </span>
              </div>
              <div className="mt-5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Получено</div>
              <div className="mt-1.5 text-3xl font-black text-white tracking-tight">
                {formatCurrency(3250000, currency, locale)}
              </div>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-pink-500/15 text-pink-400">
                  <Heart size={22} />
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-bold text-accent">
                  ↑ +8%
                </span>
              </div>
              <div className="mt-5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Направлено на помощь</div>
              <div className="mt-1.5 text-3xl font-black text-white tracking-tight">
                {formatCurrency(2870000, currency, locale)}
              </div>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                  <Scale size={22} />
                </div>
                <span className="text-xs text-gray-400 font-medium">Баланс счета</span>
              </div>
              <div className="mt-5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Остаток</div>
              <div className="mt-1.5 text-3xl font-black text-white tracking-tight">
                {formatCurrency(380000, currency, locale)}
              </div>
            </div>
          </div>
`

fs.appendFileSync('c:/Users/goret/OneDrive/Рабочий стол/Dashboard Charity/src/pages/PublicPage.tsx', part3a, 'utf8');
console.log('Part 3a appended');
