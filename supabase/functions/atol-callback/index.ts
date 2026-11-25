/**
 * Notification endpoint for Atol Pay.
 * Atol POSTs payment status here; we acknowledge it so the provider stops
 * retrying. Payment facts are still taken from the public reports data.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });

const cors = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  try {
    const payload = await req.json().catch(() => ({}));
    console.log('[atol-callback]', JSON.stringify(payload));
    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[atol-callback] failed', message);
    return json({ ok: false, error: message }, 400);
  }
});
