# Paydex — приём пожертвований

Схема: сайт → Supabase Edge Function `create-payment` → Paydex API → размещённая страница оплаты → подписанный вебхук `paydex-callback`.

Секреты не попадают в статический сайт: в браузере есть только публичный Supabase anon-ключ.

## Файлы

- `supabase/functions/create-payment/index.ts` — создание счёта, возвращает `url` страницы оплаты.
- `supabase/functions/paydex-callback/index.ts` — приём вебхуков с проверкой HMAC-SHA256.
- `.github/workflows/deploy-functions.yml` — деплой функций (нужен `SUPABASE_ACCESS_TOKEN` в GitHub Secrets).
- `src-site/index.html` — кнопки «Оплатить картой» / «Оплатить через СБП» вызывают `create-payment` с `method: card|sbp`.

## Настройка Paydex

1. Зарегистрировать проект на https://paydex.pro, указать домен `fond-urakhinskogo.ru`.
2. Подтвердить домен файлом `.well-known/paydex-verify.txt` с токеном из кабинета. Файл надо положить в `src-site/.well-known/` — тогда билд `npm run build:site` скопирует его в `public-site/.well-known/`, и в `Ctrl+U` страницы ничего лишнего не появится.
3. В настройках проекта указать webhook URL:

   ```
   https://ybgxfewbhjvtgdklzihr.supabase.co/functions/v1/paydex-callback
   ```

4. В разделе «API-ключи» взять `secret_key` (`sk_test_…` / `sk_live_…`) и `webhook_secret`.
5. В «Кто платит комиссию» можно поставить 0% на покупателе — код дополнительно передаёт `customerFeePct: 0`, поэтому донор видит ровно выбранную сумму.

## Секреты Supabase

Выполнить локально после `supabase login` и `supabase link --project-ref ybgxfewbhjvtgdklzihr`:

```bash
supabase secrets set PAYDEX_SECRET_KEY=sk_test_xxxxxxxx
supabase secrets set PAYDEX_WEBHOOK_SECRET=xxxxxxxx

# необязательные
supabase secrets set PAYDEX_SUCCESS_URL=https://fond-urakhinskogo.ru/
supabase secrets set PAYDEX_FAIL_URL=https://fond-urakhinskogo.ru/
supabase secrets set PAYDEX_CUSTOMER_FEE_PCT=0
```

Или те же значения в Supabase Dashboard → Edge Functions → Secrets.

## Деплой

Добавить в GitHub Secrets:

- `SUPABASE_ACCESS_TOKEN` — персональный токен Supabase (https://supabase.com/dashboard/account/tokens).

После пуша workflow **Deploy Paydex functions** задеплоит `create-payment` и `paydex-callback`. Можно запустить вручную через `workflow_dispatch`.

## Тестирование

Тестовые ключи `sk_test_…` работают сразу после создания проекта, до модерации:

1. Поставить `PAYDEX_SECRET_KEY=sk_test_…`, задеплоить функцию.
2. Открыть сайт, выбрать сумму, галочку согласия и нажать «Оплатить картой» или «Оплатить через СБП».
3. На странице Paydex появится жёлтая пометка «Тестовый режим» и кнопки «Успех / Отказ / Истёк».
4. Вебхук придёт на `paydex-callback` с заголовком `X-Paydex-Test: 1`; в логах функции будет event, orderId, сумма и способ оплаты.
5. После модерации заменить ключ на `sk_live_…` — код менять не нужно.

## Замечания

- Лимиты Paydex: сумма счёта 10–300 000 ₽, срок оплаты по умолчанию 60 минут.
- `orderId` генерируется сервером и уникален; повторный запрос с тем же `orderId` вернёт тот же счёт.
- Страница оплаты размещённая (hosted), `<iframe>` банками запрещён — редирект делается через `window.location.assign`.
- Комиссия Paydex от 1% удерживается с фонда; для донора надбавки нет. Вывод средств на СБП/USDT тарифицируется отдельно.
