/**
 * Creates a Paydex invoice and returns the hosted checkout URL.
 *
 * The Paydex secret key lives ONLY in Supabase function secrets — it is never
 * shipped to the browser. The site calls this function with the public anon key.
 *
 * Required Supabase secret:
 *   PAYDEX_SECRET_KEY        — sk_test_… or sk_live_… from the Paydex cabinet
 * Optional Supabase secrets:
 *   PAYDEX_SUCCESS_URL       — donor return URL after payment
 *   PAYDEX_FAIL_URL          — donor return URL after failure/expiry
 *   PAYDEX_CUSTOMER_FEE_PCT  — percent of commission paid by donor (default 0)
 *   SITE_ORIGIN              — allowed browser origin for CORS
 */

const PAYDEX_API = 'https://paydex.pro/api/v1/invoices';
const DEFAULT_SITE_ORIGIN = 'https://fond-urakhinskogo.ru,https://goretcmma-unix.github.io';
const DEFAULT_SITE_URL = 'https://fond-urakhinskogo.ru/';
const DESCRIPTION = 'Пожертвование в фонд имени Абдуллахаджи Урахинского';

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

const ERROR_MESSAGES: Record<string, string> = {
  validation: 'Платёжный сервис отклонил запрос',
  unauthorized: 'Платёжный сервис недоступен',
  project_not_active: 'Проект оплаты ещё не активирован в Paydex',
  order_id_conflict: 'Такой платёж уже создан — обновите страницу',
  amount_out_of_range: 'Сумма вне допустимого диапазона',
  customer_fee_pct_too_high: 'Некорректная комиссия платежа',
  method_unavailable: 'Этот способ оплаты временно недоступен',
  rate_limited: 'Слишком много запросов — попробуйте позже',
  provider_unavailable: 'Банк временно недоступен — попробуйте позже'
};

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

    if (!Number.isFinite(amountRub) || amountRub < 10 || amountRub > 300000) {
      return json({ ok: false, error: 'Недопустимая сумма пожертвования' }, 400);
    }

    const key = (Deno.env.get('PAYDEX_SECRET_KEY') || '').trim();
    if (!key) {
      return json({ ok: false, error: 'Платёжный сервис не настроен: отсутствует ключ Paydex' }, 503);
    }

    const successUrl = (Deno.env.get('PAYDEX_SUCCESS_URL') || DEFAULT_SITE_URL).trim();
    const failUrl = (Deno.env.get('PAYDEX_FAIL_URL') || DEFAULT_SITE_URL).trim();
    const feePctRaw = Number(Deno.env.get('PAYDEX_CUSTOMER_FEE_PCT') || 0);
    const customerFeePct = Number.isFinite(feePctRaw) && feePctRaw >= 0 ? feePctRaw : 0;

    const orderId = `DF-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const payload: Record<string, unknown> = {
      amount: amountRub.toFixed(2),
      orderId,
      description: DESCRIPTION,
      method,
      // 0 = donor pays exactly the chosen amount; the foundation absorbs the fee.
      customerFeePct,
      successUrl,
      failUrl,
      expire: 60
    };
    const name = typeof input?.name === 'string' ? input.name.trim().slice(0, 120) : '';
    if (name) payload.customer = { name };

    const paydexRes = await fetch(PAYDEX_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const rawText = await paydexRes.text();
    let data: Record<string, unknown> = {};
    try { data = rawText ? JSON.parse(rawText) as Record<string, unknown> : {}; } catch { data = {}; }

    if (!paydexRes.ok) {
      const error = data.error as { code?: string; message?: string } | undefined;
      console.error('[create-payment] Paydex error', paydexRes.status, rawText);
      return json({
        ok: false,
        error: (error && ERROR_MESSAGES[error.code || '']) || error?.message || `Ошибка платёжного сервиса: ${paydexRes.status}`
      }, 502);
    }

    const url = typeof data.url === 'string' && /^https:\/\//i.test(data.url) ? data.url : '';
    if (!url) {
      console.error('[create-payment] no checkout URL in Paydex response', rawText);
      return json({ ok: false, error: 'Платёжный сервис не вернул ссылку на оплату' }, 502);
    }

    return json({
      ok: true,
      url,
      orderId,
      invoiceId: data.id || null,
      payableAmount: data.payableAmount || null,
      method
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[create-payment] failed', message);
    return json({ ok: false, error: message }, 400);
  }
});
