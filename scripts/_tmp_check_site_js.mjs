import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'

const html = readFileSync('public-site/index.html', 'utf8')
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
let idx = 0
for (const [, attrs, code] of scripts) {
  if (/src=/.test(attrs)) continue
  if (!code.trim()) continue
  const file = `.tmp_inline_${idx++}.js`
  writeFileSync(file, code)
  try {
    // parse only
    new vm.Script(code, { filename: file })
    console.log('OK', file, code.length, 'chars')
  } catch (e) {
    console.log('SYNTAX ERROR in', file, '->', e.message)
  } finally {
    // keep file for error reporting
  }
}

// undeclared identifier scan: rough check that names used are declared
const full = scripts.map(m => m[2]).join('\n')
const names = ['currentPeriod', 'repPeriod', 'currentType', 'currentCategory', 'currentSearch', 'currentPage', 'pageSize', 'allTransactions']
for (const n of names) {
  const decl = new RegExp(`(?:let|const|var|function)\\s+${n}\\b`).test(full)
  const uses = (full.match(new RegExp(`\\b${n}\\b`, 'g')) || []).length
  console.log(n, 'declared=', decl, 'uses=', uses)
}
