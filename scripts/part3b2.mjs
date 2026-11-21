import fs from 'fs'

const part3b2 = `
        <div className="border-t border-white/10 bg-[#0d1110] px-6 py-12 lg:px-12 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-xl font-extrabold text-white">Детальная отчётность</h2>
            
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Поиск по описанию..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="rounded-xl border border-white/10 bg-black/40 pl-10 pr-4 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-accent w-64 shadow"
                />
              </div>

              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-xs text-gray-300 cursor-pointer shadow">
                <Calendar size={15} className="text-gray-400" />
                <span>Период</span>
                <ChevronDown size={14} className="text-gray-400" />
              </div>

              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-xs text-gray-300 cursor-pointer shadow">
                <Filter size={15} className="text-gray-400" />
                <span>Тип операции</span>
                <ChevronDown size={14} className="text-gray-400" />
              </div>

              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-xs text-gray-300 cursor-pointer shadow">
                <span>Категория</span>
                <ChevronDown size={14} className="text-gray-400" />
              </div>

              <button
                type="button"
                onClick={() => alert('Экспорт отчета в Excel/PDF')}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-xs font-semibold text-white hover:bg-white/10 transition shadow"
              >
                <Download size={15} /> Экспорт
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/30 shadow-xl">
            <table className="w-full min-w-[750px] border-collapse text-left text-xs">
              <thead className="bg-black/60 text-gray-400 border-b border-white/10 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="px-6 py-4 font-semibold">Дата</th>
                  <th className="px-6 py-4 font-semibold">Операция</th>
                  <th className="px-6 py-4 font-semibold">Категория</th>
                  <th className="px-6 py-4 font-semibold">Поступление</th>
                  <th className="px-6 py-4 font-semibold">Расход</th>
                  <th className="px-6 py-4 font-semibold">Документ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredTransactions.map((tx) => {
                  const isInc = tx.type === 'income'
                  return (
                    <tr key={tx.id} className="hover:bg-white/[0.03] transition">
                      <td className="px-6 py-4 text-gray-400 font-medium">{tx.date}</td>
                      <td className="px-6 py-4 flex items-center gap-3 text-white font-medium">
                        <div className={\`flex h-7 w-7 items-center justify-center rounded-full \${isInc ? 'bg-accent/20 text-accent' : 'bg-pink-500/20 text-pink-400'}\`}>
                          {isInc ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                        </div>
                        {tx.description}
                      </td>
                      <td className="px-6 py-4 text-gray-300">{tx.category}</td>
                      <td className="px-6 py-4 font-bold text-accent text-sm">
                        {isInc ? formatCurrency(tx.amount, currency, locale) : '—'}
                      </td>
                      <td className="px-6 py-4 font-bold text-gray-300 text-sm">
                        {!isInc ? formatCurrency(tx.amount, currency, locale) : '—'}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          onClick={() => alert(\`Просмотр документа: \${tx.doc}\`)}
                          className="inline-flex items-center gap-1.5 text-accent hover:underline font-medium"
                        >
                          {tx.doc} <ExternalLink size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="border-t border-white/10 bg-black px-6 py-8 text-center text-xs text-gray-500">
          © 2026 Благотворительный фонд имени Алихажи Урахинского. Все права защищены. Прозрачность и доверие.
        </footer>
      </div>
    </div>
  )
}

function LeafIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.4 19 2c2 2 2.6 3.5 3.7 9.2a7 7 0 0 1-13.9 8.8Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.5 12 13 13 12" />
    </svg>
  )
}
`

fs.appendFileSync('c:/Users/goret/OneDrive/Рабочий стол/Dashboard Charity/src/pages/PublicPage.tsx', part3b2, 'utf8');
console.log('Part 3b2 appended successfully');
