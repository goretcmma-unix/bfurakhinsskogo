// Диагностика схемы Supabase через OpenAPI (только чтение)
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Простой .env-парсер без зависимостей
const envText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'), 'utf8')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
}

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY

async function main() {
  const res = await fetch(`${url}/rest/v1/?apikey=${key}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  })
  const spec = await res.json()

  const tx = spec.definitions?.transactions
  if (!tx) { console.log('Таблица transactions не найдена в спецификации'); return }

  console.log('=== ТАБЛИЦА transactions ===')
  console.log('Требуемые поля (NOT NULL без default):', JSON.stringify(tx.required || []))
  console.log('')
  for (const [name, prop] of Object.entries(tx.properties)) {
    console.log(`  ${name.padEnd(28)} ${String(prop.type).padEnd(10)} ${prop.format || ''} ${prop.description ? '[описание]' : ''}`)
  }
  console.log('')
  console.log('=== sber_sync_runs ===')
  const runs = spec.definitions?.sber_sync_runs
  if (runs) {
    for (const [name, prop] of Object.entries(runs.properties)) {
      console.log(`  ${name.padEnd(20)} ${prop.type}`)
    }
  } else {
    console.log('  НЕ НАЙДЕНА в спецификации (миграция не применена?)')
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
