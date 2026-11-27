/**
 * Cloudflare Worker: раз в минуту дёргает repository_dispatch у GitHub Actions.
 *
 * Секрет задаётся командой:
 *   wrangler secret put GITHUB_PAT
 *
 * PAT: classic token с разрешением repo (или fine-grained с доступом к этому
 * репозиторию и правом Actions/repository_dispatch).
 */
const DISPATCH_URL =
  'https://api.github.com/repos/goretcmma-unix/bfurakhinsskogo/dispatches'

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const response = await fetch(DISPATCH_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${env.GITHUB_PAT}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'sber-dispatch-worker'
          },
          body: JSON.stringify({ event_type: 'sber-sync' })
        })

        if (!response.ok) {
          const text = await response.text().catch(() => '')
          throw new Error(`GitHub dispatch HTTP ${response.status}: ${text.slice(0, 300)}`)
        }
      })()
    )
  }
}
