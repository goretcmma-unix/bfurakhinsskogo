import fs from 'fs'

const part3b1 = `
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <div className="flex items-center gap-8 text-xs font-medium text-gray-400">
              <span className="inline-flex items-center gap-2.5"><span className="h-3 w-3 rounded-full bg-accent" />Поступления</span>
              <span className="inline-flex items-center gap-2.5"><span className="h-3 w-3 rounded-full bg-gray-500" />Расходы</span>
              <span className="inline-flex items-center gap-2.5"><span className="h-3 w-3 rounded-full bg-teal-400" />Остаток</span>
            </div>
          </div>

          <div className="h-[320px] w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={publicChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="pubGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#40E0D0" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#40E0D0" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#222b28" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#8b9693', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8b9693', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#141a18', borderColor: '#22332c', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                />
                <Bar dataKey="expenses" fill="#3a4a46" radius={[4, 4, 0, 0]} />
                <Area type="monotone" dataKey="donations" stroke="#40E0D0" strokeWidth={3} fill="url(#pubGrad)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
`

fs.appendFileSync('c:/Users/goret/OneDrive/Рабочий стол/Dashboard Charity/src/pages/PublicPage.tsx', part3b1, 'utf8');
console.log('Part 3b1 appended');
