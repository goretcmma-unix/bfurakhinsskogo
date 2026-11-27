#!/usr/bin/env node
/**
 * Синк обновляет lastAttemptAt/lastSuccessAt при каждом запуске. Если за
 * минуту не пришло новых операций и токен не ротировался, такой heartbeat не
 * должен создавать коммит (а значит, и полный редеплой GitHub Pages).
 *
 * Возвращает state.json ровно в том виде, в каком он лежит в HEAD, если
 * изменились только таймстемпы. Все остальные изменения остаются нетронутыми.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const relative = '.sber-data/sber-sync/state.json'
const target = path.join(root, relative)

function normalize(text) {
  try {
    const parsed = JSON.parse(text)
    delete parsed.lastAttemptAt
    delete parsed.lastSuccessAt
    return JSON.stringify(parsed)
  } catch {
    return String(text).trim()
  }
}

if (!fs.existsSync(target)) {
  console.log('state_changed')
  process.exit(0)
}

const current = fs.readFileSync(target, 'utf8')
let committed = ''
try {
  committed = execFileSync('git', ['show', `HEAD:${relative}`], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
} catch {
  // Файла ещё нет в HEAD — коммит нужен.
}

if (normalize(current) === normalize(committed)) {
  fs.writeFileSync(target, committed, 'utf8')
  console.log('heartbeat_only')
} else {
  console.log('state_changed')
}
