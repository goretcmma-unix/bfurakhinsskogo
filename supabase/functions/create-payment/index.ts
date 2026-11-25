/**
 * Creates an Atol Pay payment and returns the hosted checkout URL.
 *
 * The Atol bearer token lives ONLY in Supabase function secrets — it is never
 * shipped to the browser. The site calls this function with the public anon key.
 *
 * Required Supabase secrets:
 *   ATOLPAY_ACCESS_TOKEN   — token from the Atol Pay personal account
 * Optional Supabase secrets:
 *   ATOLPAY_RETURN_URL     — where the donor goes after paying
 *   ATOLPAY_NOTIFICATION_URL — callback endpoint (defaults to atol-callback)
 *   ATOLPAY_BANK_ID        — bankId from the merchant agreement (default 100)
 *   SITE_ORIGIN            — allowed browser origin for CORS
 */

const ATOL_API = 'https://new-api-mobile.atolpay.ru/v1/ecom/payments';
const DEFAULT_SITE_ORIGIN = 'https://fond-urakhinskogo.ru,https://goretcmma-unix.github.io';
const DEFAULT_SITE_URL = 'https://fond-urakhinskogo.ru/';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });

const allowedOrigin = (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const configured = (Deno.env.get('SITE_ORIGIN') || DEFAULT_SITE_ORIGIN).split(',').map((s) => s.trim());
  const allowed = [...configured, 'http://localhost:8765', 'http://127.0.0.1:8765'];
  return allowed.includes(origin) ? origin : (configured[0] || DEFAULT_SITE_ORIGIN);
};

const cors = (req: Request) => ({
  'Access-Control-Allow-Origin': allowedOrigin(req),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
});

/** Atol does not document one fixed field for the checkout link in every
 *  integration version, so look for the common ones first, then any URL.
 *  Echoed returnUrl/notificationUrl are skipped deliberately. */
function findCheckoutUrl(value: unknown, depth = 0): string | null {
  if (value == null || depth > 6) return null;
  if (typeof value === 'string') {
    const v = value.trim();
    return /^https?:\/\//i.test(v) ? v : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCheckoutUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;

  const obj = value as Record<string, unknown>;
  const preferred = [
    'paymentUrl', 'redirectUrl', 'checkoutUrl', 'paymentLink',
    'formUrl', 'payUrl', 'url', 'link', 'href'
  ];
  const skipped = new Set([
    'returnUrl', 'notificationUrl', 'callbackUrl', 'webhookUrl',
    'successUrl', 'failUrl'
  ]);

  for (const key of preferred) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const found = findCheckoutUrl(obj[key], depth + 1);
      if (found) return found;
    }
  }
  for (const key of Object.keys(obj)) {
    if (preferred.includes(key) || skipped.has(key)) continue;
    const found = findCheckoutUrl(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function findPaymentId(value: unknown, depth = 0): string | null {
  if (value == null || depth > 5 || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  for (const key of ['paymentId', 'payment_id', 'transactionId', 'id']) {
    const v = obj[key];
    if (typeof v === 'string' || typeof v === 'number') return String(v);
  }
  for (const key of Object.keys(obj)) {
    const found = findPaymentId(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors(req) });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const input = await req.json() as { amount?: unknown; method?: unknown; name?: unknown };
    const amountRub = Number(input?.amount);
    const method = input?.method === 'sbp' ? 'sbp' : 'card';

    if (!Number.isFinite(amountRub) || amountRub < 50 || amountRub > 1_000_000) {
      return json({ ok: false, error: 'Недопустимая сумма пожертвования' }, 400);
    }

    const token = (Deno.env.get('ATOLPAY_ACCESS_TOKEN') || '').trim();
    if (!token) {
      return json({ ok: false, error: 'Платёжный сервис не настроен: отсутствует токен Атол Пэй' }, 503);
    }

    const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
    const returnUrl = (Deno.env.get('ATOLPAY_RETURN_URL') || DEFAULT_SITE_URL).trim();
    const notificationUrl = (
      Deno.env.get('ATOLPAY_NOTIFICATION_URL') ||
      (supabaseUrl ? `${supabaseUrl}/functions/v1/atol-callback` : '')
    ).trim();
    const bankIdRaw = Number(Deno.env.get('ATOLPAY_BANK_ID') || 100);
    const bankId = Number.isFinite(bankIdRaw) && bankIdRaw > 0 ? Math.trunc(bankIdRaw) : 100;

    const orderId = `DF-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const atolBody = {
      amount: Math.round(amountRub * 100),
      orderId,
      sessionType: 'oneStep',
      additionalProps: { returnUrl, notificationUrl },
      paymentMethods: [{ paymentType: method, bankId }]
    };

    const atolRes = await fetch(ATOL_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(atolBody)
    });

    const rawText = await atolRes.text();
    let atolData: unknown = null;
    try { atolData = rawText ? JSON.parse(rawText) : null; } catch { atolData = { raw: rawText }; }

    if (!atolRes.ok) {
      console.error('[create-payment] Atol Pay error', atolRes.status, rawText);
      return json(
        { ok: false, error: `Платёжный сервис вернул ошибку ${atolRes.status}`, details: atolData },
        502
      );
    }

    const url = findCheckoutUrl(atolData);
    if (!url) {
      console.error('[create-payment] no checkout URL in Atol response', rawText);
      return json(
        { ok: false, error: 'Платёжный сервис не вернул ссылку на оплату', details: atolData },
        502
      );
    }

    return json({
      ok: true,
      url,
      orderId,
      paymentId: findPaymentId(atolData),
      method
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[create-payment] failed', message);
    return json({ ok: false, error: message }, 400);
  }
});
