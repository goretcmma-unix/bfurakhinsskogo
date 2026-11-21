import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')

const text = readFileSync('.env', 'utf8').replace(/^\uFEFF/, '')
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
}

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
console.log('URL host:', new URL(url).host, '| key type:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'anon')

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

async function count(label, build) {
  const { count, error } = await build()
  console.log(label.padEnd(46), error ? `ERROR: ${error.message}` : count)
}

const all = () => db.from('transactions').select('id', { count: 'exact', head: true })
await count('transactions: всего', all)
await count("transactions: data_source='csv'", () => all().eq('data_source', 'csv'))
await count("transactions: data_source='sber_api'", () => all().eq('data_source', 'sber_api'))
await count('transactions: data_source is null', () => all().is('data_source', null))

const { data: minmax, error: mmErr } = await db
  .from('transactions')
  .select('transaction_date,data_source')
  .order('transaction_date', { ascending: true })
  .limit(1)
console.log('самая ранняя:', mmErr ? mmErr.message : JSON.stringify(minmax))

const { data: latest, error: lErr } = await db
  .from('transactions')
  .select('transaction_date,data_source,type,amount')
  .order('transaction_date', { ascending: false })
  .limit(8)
console.log('последние 8:', lErr ? lErr.message : '')
for (const r of latest || []) console.log('   ', r.transaction_date, (r.data_source || '-').padEnd(9), (r.type || '-').padEnd(7), r.amount)

const { data: lastSber, error: lsErr } = await db
  .from('transactions')
  .select('transaction_date,created_at,bank_transaction_id')
  .eq('data_source', 'sber_api')
  .order('transaction_date', { ascending: false })
  .limit(3)
console.log('последние sber_api:', lsErr ? lsErr.message : '')
for (const r of lastSber || []) console.log('   ', r.transaction_date, r.bank_transaction_id)

const { error: runsErr } = await db.from('sber_sync_runs').select('id').limit(1)
console.log('sber_sync_runs:', runsErr ? `ERROR: ${runsErr.message}` : 'OK')

const { data: funds, error: fErr } = await db.from('funds').select('id,name').limit(3)
console.log('funds:', fErr ? fErr.message : JSON.stringify(funds))
