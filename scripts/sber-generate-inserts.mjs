#!/usr/bin/env node
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
try {
  const envText = readFileSync(join(root, '.env'), 'utf8')
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
} catch {}
const mod = require(join(root, 'out', 'main', 'sber-api', 'index.js'))
const api = new mod.SberApi({ userDataDir: join(root, '.sber-data') })
const stage = await api.sync.fetchAndStage({ accountNumber: process.env.SBER_SANDBOX_ACCOUNT_NUMBER || '40702810338000001464', fromDate: '2022-06-01', toDate: '2022-06-01' })
const st = await api.sync.loadStage()
const priv = st?.privateTransactions || []
console.log('-- Run in Supabase SQL Editor')
for (const t of priv) {
  const amt = Number(t.amount)
  const date = t.date
  const desc = String(t.category || 'Sber').replace(/'/g, "''")
  const ext = String(t.externalId).replace(/'/g, "''")
  console.log(`insert into public.transactions (fund_id, transaction_date, type, amount, currency, description, data_source, bank_transaction_id, is_public) select id, '${date}'::timestamptz, 'expense', ${amt}, 'RUB', '${desc}', 'sber_api', '${ext}', true from public.funds limit 1 on conflict (fund_id, bank_transaction_id) where data_source='sber_api' do nothing;`)
}
console.log('-- done, rows:', priv.length)
