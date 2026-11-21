#!/usr/bin/env node
import http from 'node:http'
import { URL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
try {
  const envText = readFileSync(join(root, '.env'), 'utf8')
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  }
} catch {}
const mod = require(join(root, 'out', 'main', 'sber-api', 'index.js'))
const { SberApi } = mod
const { sberRequest } = mod
const api = new SberApi({ userDataDir: join(root, '.sber-data') })
try {
  const oauthStatus = await api.oauth.status()
  if (process.env.SBER_ACCESS_TOKEN) {
    await api.oauth.setTokens({
      accessToken: process.env.SBER_ACCESS_TOKEN,
      refreshToken: process.env.SBER_REFRESH_TOKEN || '',
      expiresInSeconds: Number(process.env.SBER_TOKEN_EXPIRES_IN || 3600)
    })
    console.log('Sber tokens loaded from .env (overwriting store)')
  } else if (oauthStatus.hasRefreshToken) {
    console.log('Using Sber tokens from .sber-data store')
  } else {
    console.log('No Sber tokens in store and no SBER_ACCESS_TOKEN in .env')
  }
} catch (e) {
  console.log('Token init failed:', String(e?.message || e))
}

const PORT = Number(process.env.PORT || 5174)
const CB_PORT = 28016
const states = new Map()

function getAccountNumber() {
  const env = (api.config?.environment || process.env.SBER_API_ENV || 'sandbox').toLowerCase()
  const generic = (process.env.SBER_ACCOUNT_NUMBER || '').trim()
  if (generic) return generic
  if (env === 'production') {
    return (process.env.SBER_PRODUCTION_ACCOUNT_NUMBER || process.env.SBER_SANDBOX_ACCOUNT_NUMBER || '').trim()
  }
  return (process.env.SBER_SANDBOX_ACCOUNT_NUMBER || process.env.SBER_PRODUCTION_ACCOUNT_NUMBER || '').trim()
}

function getTokenUrl() {
  const env = (api.config?.environment || process.env.SBER_API_ENV || 'sandbox').toLowerCase()
  if (env === 'production') {
    return process.env.SBER_PRODUCTION_TOKEN_URL || api.config?.endpoints?.production?.tokenUrl || ''
  }
  return process.env.SBER_SANDBOX_TOKEN_URL || api.config?.endpoints?.sandbox?.tokenUrl || ''
}

const envLabel = (api.config?.environment || process.env.SBER_API_ENV || 'sandbox') === 'production' ? 'Production' : 'Sandbox'

const PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Sber ${envLabel} Test</title>
<style>body{font-family:system-ui;margin:20px;background:#0f172a;color:#e2e8f0}button{padding:8px 12px;margin:4px;border:0;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer}pre{background:#1e293b;padding:12px;border-radius:8px;overflow:auto;max-height:400px}.row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}</style>
</head><body>
<h1>Sber ${envLabel} — диагностика</h1>
<div class="row">
<button onclick="call('/api/sber/inspect')">Inspect</button>
<button onclick="call('/api/sber/diagnose')">Diagnose</button>
<button onclick="call('/api/sber/oauth/status')">OAuth status</button>
<button onclick="call('/api/sber/statements/account')">Account statement</button>
<button onclick="call('/api/sber/statements/transactions')">Transactions</button>
</div>
<pre id="out">Нажмите кнопку…</pre>
<script>
async function call(u){const r=await fetch(u);const t=await r.text();try{document.getElementById('out').textContent=JSON.stringify(JSON.parse(t),null,2)}catch(e){document.getElementById('out').textContent=t}}
</script></body></html>`

async function handleApi(req, res, u) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  try {
    if (u.pathname === '/api/sber/inspect') { res.end(JSON.stringify(await api.inspect())); return }
    if (u.pathname === '/api/sber/diagnose') { res.end(JSON.stringify(await api.diagnose())); return }
    if (u.pathname === '/api/sber/oauth/status') { res.end(JSON.stringify(await api.oauth.status())); return }
    if (u.pathname === '/api/sber/oauth/start') {
      const auth = api.oauth.buildAuthorizeUrl()
      if (!auth) { res.statusCode=400; res.end(JSON.stringify({error:'authorize url not configured'})); return }
      states.set(auth.state, Date.now())
      res.end(JSON.stringify({ url: auth.url, state: auth.state }))
      return
    }
    const q = {
      accountNumber: getAccountNumber() || '40702810338000042025',
      fromDate: process.env.SBER_STATEMENT_DATE || '2025-03-04',
      toDate: process.env.SBER_STATEMENT_DATE || '2025-03-04'
    }
    if (u.pathname === '/api/sber/statements/account') {
      try { res.end(JSON.stringify(await api.statements.getAccountStatement(q))); return }
      catch (e) { res.end(JSON.stringify({ error: String(e?.message || e) })); return }
    }
    if (u.pathname === '/api/sber/statements/transactions') {
      try { res.end(JSON.stringify(await api.statements.getTransactionStatement(q))); return }
      catch (e) { res.end(JSON.stringify({ transactions: [], days: 0, failedDates: [], error: String(e?.message || e) })); return }
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' }))
  } catch (e) {
    res.statusCode = 500; res.end(JSON.stringify({ error: String(e?.message || e) }))
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost')
  if (u.pathname === '/sber-test') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(PAGE); return
  }
  await handleApi(req, res, u)
})
server.listen(PORT, () => console.log(`Sber ${envLabel} server: http://localhost:${PORT}/sber-test`))

// Callback server on 28016
const cbServer = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost')
  const code = u.searchParams.get('code')
  const state = u.searchParams.get('state')
  const err = u.searchParams.get('error')
  if (err) {
    res.setHeader('Content-Type','text/html; charset=utf-8')
    res.end(`<h1>Ошибка авторизации</h1><pre>${err}: ${u.searchParams.get('error_description')||''}</pre>`)
    return
  }
  if (!code || !state || !states.has(state)) {
    res.statusCode = 400
    res.setHeader('Content-Type','text/html; charset=utf-8')
    res.end('<h1>Неверный callback (state/code)</h1>')
    return
  }
  states.delete(state)
  try {
    const tokenUrl = getTokenUrl()
    if (!tokenUrl) throw new Error('Token URL not configured for selected environment')
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.SBER_REDIRECT_URI,
      client_id: process.env.SBER_CLIENT_ID,
      client_secret: process.env.SBER_CLIENT_SECRET
    }).toString()
    const result = await sberRequest(api.tls, {
      method: 'POST',
      url: tokenUrl,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    if (!result.ok) {
      res.statusCode = 500
      res.setHeader('Content-Type','text/html; charset=utf-8')
      res.end(`<h1>Ошибка обмена токена</h1><pre>HTTP ${result.status}</pre>`)
      return
    }
    const json = result.json || {}
    await api.oauth.setTokens({
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresInSeconds: json.expires_in
    })
    res.setHeader('Content-Type','text/html; charset=utf-8')
    res.end('<h1>Авторизация успешна</h1><p>Токены сохранены. Закройте окно.</p>')
  } catch (e) {
    res.statusCode = 500
    res.setHeader('Content-Type','text/html; charset=utf-8')
    res.end(`<h1>Ошибка</h1><pre>${String(e?.message||e)}</pre>`)
  }
})
cbServer.listen(CB_PORT, () => console.log(`Sber callback server: http://localhost:${CB_PORT}`))
