#!/usr/bin/env node
/**
 * Отправляет repository_dispatch в GitHub, чтобы workflow Sber auto-sync
 * запускался раз в минуту без ненадёжного GitHub schedule и без Cloudflare.
 *
 * PAT хранится локально в .local/github-pat.txt и НЕ попадает в git.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const localDir = path.join(root, '.local')
fs.mkdirSync(localDir, { recursive: true })

const tokenPath = path.join(localDir, 'github-pat.txt')
if (!fs.existsSync(tokenPath)) {
  console.error(`[sber:dispatch] Нет файла ${path.relative(root, tokenPath)} — положите туда GitHub PAT`)
  process.exit(1)
}

const token = fs.readFileSync(tokenPath, 'utf8').replace(/^\uFEFF/, '').trim()
if (!token) {
  console.error('[sber:dispatch] Файл github-pat.txt пустой')
  process.exit(1)
}

const response = await fetch(
  'https://api.github.com/repos/goretcmma-unix/bfurakhinsskogo/dispatches',
  {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sber-dispatch-local'
    },
    body: JSON.stringify({ event_type: 'sber-sync' })
  }
)

if (!response.ok) {
  const text = await response.text().catch(() => '')
  console.error(`[sber:dispatch] GitHub HTTP ${response.status}: ${text.slice(0, 300)}`)
  process.exit(1)
}

console.log(JSON.stringify({
  ts: new Date().toISOString(),
  event: 'dispatch_sent',
  status: response.status
}))
