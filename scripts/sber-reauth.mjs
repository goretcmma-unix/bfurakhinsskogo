#!/usr/bin/env node
/**
 * Повторная авторизация Sber API в один шаг.
 *
 *   npm run sber:reauth
 *
 * Скрипт печатает ссылку СберБизнеса, ждёт callback на SBER_REDIRECT_URI
 * (по умолчанию http://localhost:28016), обменивает code на токены,
 * сохраняет их в .sber-data и обновляет SBER_ACCESS_TOKEN / SBER_REFRESH_TOKEN в .env.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const envText = await fs.readFile(envPath, 'utf8').catch(() => '');

function parseEnv(text) {
  const out = {};
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const env = parseEnv(envText);
for (const [key, value] of Object.entries(env)) {
  if (!(key in process.env)) process.env[key] = value;
}

function upsertEnvValue(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value ?? ''}`;
  if (re.test(text)) return text.replace(re, line);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return text.replace(/\s*$/, '') + eol + line + eol;
}

const mod = await import(pathToFileURL(path.join(root, 'out/main/sber-api/index.js')).href);
const { SberApi, sberRequest } = mod;
const api = new SberApi({ userDataDir: path.join(root, '.sber-data') });

const auth = api.oauth.buildAuthorizeUrl();
if (!auth) {
  console.error('[reauth] Не задан SBER_AUTHORIZE_URL / SBER_CLIENT_ID / SBER_REDIRECT_URI в .env');
  process.exit(1);
}

const environment = (api.config?.environment || process.env.SBER_API_ENV || 'sandbox').toLowerCase();
const tokenUrl = environment === 'production'
  ? process.env.SBER_PRODUCTION_TOKEN_URL || api.config?.endpoints?.production?.tokenUrl
  : process.env.SBER_SANDBOX_TOKEN_URL || api.config?.endpoints?.sandbox?.tokenUrl;
if (!tokenUrl) {
  console.error('[reauth] Не задан URL токена для окружения ' + environment);
  process.exit(1);
}

const redirect = new URL(process.env.SBER_REDIRECT_URI || 'http://localhost:28016');
const port = Number(redirect.port || (redirect.protocol === 'https:' ? 443 : 80));

let finished = false;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const respond = (status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(body);
  };

  if (u.searchParams.get('error')) {
    respond(400, `<h1>Ошибка авторизации</h1><pre>${u.searchParams.get('error')}: ${u.searchParams.get('error_description') || ''}</pre>`);
    return;
  }
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  if (!code || state !== auth.state) {
    respond(400, '<h1>Неверный callback</h1><p>Код или state не совпал. Повторите команду.</p>');
    return;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.SBER_REDIRECT_URI,
      client_id: process.env.SBER_CLIENT_ID,
      client_secret: process.env.SBER_CLIENT_SECRET,
    }).toString();
    const result = await sberRequest(api.tls, {
      method: 'POST',
      url: tokenUrl,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!result.ok) {
      respond(500, `<h1>Ошибка обмена кода</h1><pre>HTTP ${result.status}</pre>`);
      return;
    }
    const json = result.json || {};
    await api.oauth.setTokens({
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresInSeconds: json.expires_in,
      scope: json.scope || process.env.SBER_SCOPES,
    });

    let next = await fs.readFile(envPath, 'utf8').catch(() => envText);
    next = upsertEnvValue(next, 'SBER_ACCESS_TOKEN', json.access_token || '');
    next = upsertEnvValue(next, 'SBER_REFRESH_TOKEN', json.refresh_token || '');
    if (json.expires_in) next = upsertEnvValue(next, 'SBER_TOKEN_EXPIRES_IN', String(json.expires_in));
    await fs.writeFile(envPath, next, 'utf8');

    finished = true;
    respond(200, '<h1>Авторизация успешна</h1><p>Токены сохранены. Закройте окно и вернитесь в CMD.</p>');
    console.log('[reauth] Токены сохранены в .sber-data и .env');
    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 300);
  } catch (e) {
    respond(500, `<h1>Ошибка</h1><pre>${String(e?.message || e)}</pre>`);
    console.error('[reauth] Ошибка:', e?.message || e);
  }
});

server.on('error', (e) => {
  console.error(`[reauth] Не удалось слушать порт ${port}:`, e?.message || e);
  process.exit(1);
});

server.listen(port, () => {
  console.log('[reauth] Ожидаю callback на http://localhost:' + port);
  console.log('\n1. Откройте в браузере эту ссылку:\n');
  console.log(auth.url);
  console.log('\n2. Войдите в СберБизнес и подтвердите доступ.\n');
});
