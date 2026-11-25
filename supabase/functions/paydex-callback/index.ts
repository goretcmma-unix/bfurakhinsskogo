/**
 * Signed webhook endpoint for Paydex.
 *
 * Paydex sends invoice.paid / failed / expired and refund events here.
 * The signature is HMAC-SHA256 of the RAW request body with PAYDEX_WEBHOOK_SECRET.
 * Required Supabase secret: PAYDEX_WEBHOOK_SECRET
 */

const encoder = new TextEncoder();
const seen = new Map<string, number>();

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

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const secret = (Deno.env.get('PAYDEX_WEBHOOK_SECRET') || '').trim();
  if (!secret) {
    console.error('[paydex-callback] PAYDEX_WEBHOOK_SECRET is not configured');
    return json({ ok: false, error: 'Webhook secret is not configured' }, 503);
  }

  const raw = await req.text();
  const provided = (req.headers.get('x-paydex-signature') || '').replace(/^sha256=/i, '').toLowerCase();
  const expected = await hmacHex(secret, raw);

  if (!provided || !constantTimeEqual(provided, expected)) {
    console.error('[paydex-callback] invalid signature');
    return json({ ok: false, error: 'Invalid signature' }, 401);
  }

  const timestamp = Number(req.headers.get('x-paydex-timestamp'));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300) {
    console.error('[paydex-callback] invalid timestamp');
    return json({ ok: false, error: 'Invalid timestamp' }, 401);
  }

  const deliveryId = req.headers.get('x-paydex-delivery-id') || '';
  const nowMs = Date.now();
  for (const [id, at] of seen) {
    if (nowMs - at > 24 * 60 * 60 * 1000) seen.delete(id);
  }
  if (deliveryId && seen.has(deliveryId)) {
    return json({ ok: true, duplicate: true });
  }
  if (deliveryId) seen.set(deliveryId, nowMs);

  try {
    const event = JSON.parse(raw) as { event?: string; data?: { invoice?: { orderId?: string; status?: string; amount?: string; method?: string } } };
    const invoice = event.data?.invoice;
    console.log('[paydex-callback]', JSON.stringify({
      event: event.event,
      orderId: invoice?.orderId,
      status: invoice?.status,
      amount: invoice?.amount,
      method: invoice?.method,
      test: req.headers.get('x-paydex-test') === '1'
    }));
  } catch (error) {
    console.error('[paydex-callback] failed to parse payload', error);
  }

  return json({ ok: true });
});
