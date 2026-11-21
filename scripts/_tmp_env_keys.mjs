import { readFileSync } from 'node:fs'

const text = readFileSync('.env', 'utf8').replace(/^\uFEFF/, '')
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (m) console.log(m[1].padEnd(40), m[2].length ? `len=${m[2].length}` : 'EMPTY')
}
