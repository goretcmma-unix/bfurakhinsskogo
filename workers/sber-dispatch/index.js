/**
 * Cloudflare Worker: раз в минуту отправляет repository_dispatch в GitHub,
 * чтобы Sber auto-sync запускался без задержек GitHub-планировщика.
 *
 * Секрет задаётся:
 *   npx wrangler secret put GITHUB_PAT
 *
 * Логи смотреть так:
 *   npx wrangler tail sber-dispatch
 */

const DISPATCH_URL =
  'https://api.github.com/repos/goretcmma-unix/bfurakhinsskogo/dispatches'
const EVENT_TYPE = 'sber-sync'

function shortBody(text) {
  return String(text ?? '').slice(0, 1000)
}

async function dispatchToGitHub(env) {
  const token = typeof env?.GITHUB_PAT === 'string' ? env.GITHUB_PAT.trim() : ''

  // Никогда не логируем сам токен — только факт его наличия.
  if (!token) {
    console.error('[sber-dispatch] GITHUB_PAT is missing or empty')
    console.error('[sber-dispatch] Run: npx wrangler secret put GITHUB_PAT')
    throw new Error('GITHUB_PAT is missing')
  }

  let response
  try {
    response = await fetch(DISPATCH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        // GitHub API отклоняет запросы без User-Agent.
        'User-Agent': 'sber-dispatch-worker'
      },
      body: JSON.stringify({ event_type: EVENT_TYPE })
    })
  } catch (e) {
    console.error('[sber-dispatch] fetch failed', {
      name: e?.name ?? null,
      message: e?.message ?? String(e),
      url: DISPATCH_URL
    })
    throw e
  }

  const bodyText = await response.text().catch(() => '')

  if (!response.ok) {
    // Подробный лог только при ошибке; токен в логи не попадает.
    console.error('[sber-dispatch] GitHub rejected dispatch', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      eventType: EVENT_TYPE,
      url: DISPATCH_URL,
      body: shortBody(bodyText)
    })
    throw new Error(`GitHub dispatch HTTP ${response.status}: ${shortBody(bodyText)}`)
  }

  console.log('[sber-dispatch] dispatch accepted', {
    status: response.status,
    eventType: EVENT_TYPE
  })
  return response
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchToGitHub(env))
  },

  // Ручная проверка: открыть https://<worker>.workers.dev/dispatch
  async fetch(request, env) {
    try {
      await dispatchToGitHub(env)
      return new Response('sber-dispatch ok\n', { status: 200 })
    } catch (e) {
      return new Response(
        `sber-dispatch failed: ${e?.message ?? String(e)}\n`,
        { status: 500 }
      )
    }
  }
}
