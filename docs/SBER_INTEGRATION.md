# Интеграция Sber API — состояние и план

## 1. Что уже реализовано (код готов и проверен)

```
electron/sber-api/
├── index.ts        — фасад модуля: inspect(), diagnose(), доступ к oauth/sync
├── config.ts       — конфигурация Sandbox/Production, проверка полноты
├── logger.ts       — журнал с автоматической зачисткой секретов
├── secureStore.ts  — хранение токенов (AES-256-GCM) и сертификата
├── httpClient.ts   — HTTPS + mTLS (.p12), понятные ошибки
├── oauth.ts        — приём токенов, проверка срока, авто-refresh
├── statements.ts   — выписки (GET_STATEMENT_ACCOUNT / GET_STATEMENT_TRANSACTION)
├── normalize.ts    — разделение на приватные и публичные данные
└── sync.ts         — загрузка выписки → нормализация → дедупликация → стейдж
```

- Секреты живут только в main-процессе. React и публичный сайт их не получают.
- Production заблокирован на уровне кода (`assertSandbox()`).
- Мост в UI: IPC `sber:inspect`, `sber:setTokens`, `sber:diagnose` (main.ts).

## 2. Данные проверки

| Проверка | Команда | Результат |
|---|---|---|
| Типы модуля | `npx tsc --noEmit -p tsconfig.json` | 0 ошибок в `sber-api` |
| Сборка | `npx electron-vite build` | `out/main/sber-api/index.js` создан |
| Диагностика Sandbox | `npm run sber:check` | работает, показывает недостающие параметры |
| Логика нормализации | `npm run sber:test` | все проверки пройдены |
| OAuth: ТЗ, 401/403, утечки | `npm run sber:test` | 23 проверки пройдены |

### Автоматическое определение срока Access Token

Дата НЕ зашита в код. Срок определяется так (по убыванию достоверности):

1. `expires_in` из ответа OAuth-сервера при обновлении токена — самый точный;
2. дата из личного кабинета, переданная в `setTokens({ expiresAt: '18.12.2026 07:27:18' })`;
3. если срок неизвестен — токен считается валидным до первого 401 от банка.

Часовой пояс: ЛК Сбера показывает время по Москве. Настройка `SBER_TIMEZONE_OFFSET=180`
(в минутах от UTC) говорит модулю, в какой зоне трактовать дату — результат не зависит
от часового пояса компьютера. Явная зона в строке (`+03:00`, `Z`) имеет приоритет.

Обновление токена:

- **401** — токен протух: `markTokenRejected()` → один `refresh()` → один повтор запроса;
- **403** — недостаток прав/сертификат: обновление **не выполняется**, ошибка `INSUFFICIENT_SCOPE`;
- `refresh()` защищён от параллельных вызовов (`refreshInFlight`);
- после обновления сохраняется **новая пара** (access + refresh), если банк её выдал;
- `refreshIfExpiringSoon()` — проактивное обновление за 10 минут до истечения.

Секреты: в хранилище и журнале нет ни токенов, ни их фрагментов — только `len:<длина>`.

Что подтверждено тестом нормализации:
- исходящие операции не публикуются;
- дубли отсекаются (ID операции);
- копейки не теряются (`2500,50` → `2500.5`);
- дата приводится к `YYYY-MM-DD`;
- в публичном наборе **нет** ФИО, счетов, ИНН;
- сумма поступлений считается по валютам отдельно.

## 3. Подтверждённые адреса Sandbox

Все четыре адреса взяты из **официальной Postman-коллекции Sber API** и сверены
с docs.sber.ru — не догадки.

Источники:
- Коллекция: https://developers.sber.ru/docs/ru/sber-api/collection/collection-sber-api
- Файл: `Sber_API_Collection.postman_collection.json` (переменная `baseUrl`)

| Параметр | Значение | Где в коллекции |
|---|---|---|
| `SBER_SANDBOX_BASE_URL` | `https://fintech-test.sberbank.ru:9443` | переменная `baseUrl` |
| `SBER_SANDBOX_TOKEN_URL` | `https://fintech-test.sberbank.ru:9443/ic/sso/api/oauth/token` | папка «OAuth Methods» |
| `SBER_SANDBOX_STATEMENT_ACCOUNT_PATH` | `/fintech/api/v2/statement/summary` | папка «Statements» |
| `SBER_SANDBOX_STATEMENT_TRANSACTION_PATH` | `/fintech/api/v2/statement/transactions` | папка «Statements» |

Проверка сетевого доступа к Sandbox прошла: TLS-соединение установлено (`[OK] mTLS-сертификат`).
Обратите внимание: Production-хост — `fintech.sberbank.ru` (без `-test`), код его блокирует.

### Что ещё нужно (значения только у вас)

1. `SBER_CLIENT_ID` — из личного кабинета Сбера.
2. `SBER_P12_PATH` + `SBER_P12_PASSWORD` — сертификат и его пароль.
3. `SBER_REDIRECT_URI` — если приложение зарегистрировано с redirect.
4. Токены — через `setTokens({ accessToken, refreshToken, expiresAt })`.

## 3.1. Что нужно от вас

1. **Заполнить `.env`** — список переменных и пометки `[ДОК]` / `[ВАШИ]` в `.env.example`.
2. **Положить `.p12`** в недоступное репозиторию место и указать `SBER_P12_PATH`.
3. **Уточнить 4 адреса** из спецификации вашего продукта (я их не выдумываю):
   - `SBER_SANDBOX_BASE_URL`
   - `SBER_SANDBOX_TOKEN_URL`
   - `SBER_SANDBOX_STATEMENT_ACCOUNT_PATH`
   - `SBER_SANDBOX_STATEMENT_TRANSACTION_PATH`
4. **Уточнить формат токен-запроса**: `SBER_TOKEN_GRANT_TYPE`, `SBER_TOKEN_BODY_FORMAT`.
5. **Тестовый счёт** Sandbox и период для первой выписки.

## 4. План подключения к Supabase (не выполнено намеренно)

### 4.1. Две таблицы вместо одной

Сейчас в БД есть `transactions` (ручной учёт). Для банка нужны отдельные таблицы,
чтобы банковские ПДн физически не могли попасть в публичную выборку.

```sql
-- ПРИВАТНАЯ: только service_role / серверная часть
create table if not exists sber_transactions_private (
  id                  uuid primary key default gen_random_uuid(),
  external_id         text unique not null,      -- отсечение дублей
  bank_id             text,
  operation_date      date not null,
  operation_at        timestamptz,
  amount_minor        bigint not null,
  currency            char(3) not null,
  direction           text not null check (direction in ('incoming','outgoing','unknown')),
  account_number      text,
  counterparty_name   text,
  counterparty_account text,
  counterparty_bank   text,
  counterparty_inn    text,
  purpose             text,
  raw                 jsonb,
  created_at          timestamptz default now()
);

-- ПУБЛИЧНАЯ: минимальный набор, без ПДн
create table if not exists sber_transactions_public (
  id          uuid primary key default gen_random_uuid(),
  external_id text unique not null,
  tx_date     date not null,
  amount      numeric(14,2) not null,
  currency    char(3) not null,
  category    text not null,
  source_type text not null default 'unknown',
  created_at  timestamptz default now()
);

-- RLS: публичная читается анонимно, приватная — запрещена
alter table sber_transactions_public enable row level security;
alter table sber_transactions_private enable row level security;
create policy "public read public tx" on sber_transactions_public
  for select to anon using (true);
-- Политик на sber_transactions_private для anon нет вовсе = доступ закрыт
```

Ключевое: **запись идёт только с `service_role`**, а он есть только в main-процессе
(или на сервере), но не в `.env` renderer-части и не на публичном сайте.

### 4.2. Порядок записи операции

```
выписка банка
   ├─> normalize() ──> private  ──> insert ... on conflict (external_id) do nothing
   └─> normalize() ──> public   ──> insert ... on conflict (external_id) do nothing
```

`on conflict (external_id) do nothing` — единственно надёжная защита от дублей
при повторных выгрузках и параллельных запусках.

### 4.3. Сумма поступлений

- Считать на сервере: `select currency, sum(amount) from sber_transactions_public group by currency`.
- Валюты **не смешивать** (сейчас так же работает график в приложении).
- Кэш суммы допустим, но пересчитывать после каждого синка.

### 4.4. Обновление сайта

Публичный сайт уже читает Supabase. Варианты:
1. Оставить view `public_transactions` и настроить представление поверх новой
   публичной таблицы (минимальные правки сайта).
2. Писать в существующую `public_transactions` при синке (быстрее, но смешивает
   ручные и банковские записи — нужно поле `origin`).

Рекомендую вариант 1: отдельная таблица + view, чтобы источник данных был явным.

## 5. Правила публикации (жёсткие)

Разрешено в публичных данных: `date`, `amount`, `currency`, `external_id`, `category`.
Запрещено: ФИО, номера счетов и карт, БИК, ИНН, телефоны, назначение платежа,
токены, полный таймштамп, любые поля из `raw`.

Проверка это уже покрывает автотестом (`scripts/sber-normalize-test.mjs`).
При подключении к БД тест стоит расширить: сравнивать колонки публичной таблицы
с белым списком.

## 6. Фоновый синк — когда включим

После получения токенов и адресов:
1. ручной запуск `sber.sync.fetchAndStage({accountNumber, fromDate, toDate})`;
2. проверка стейджа (`stageSummary()`);
3. включение записи в БД;
4. расписание: раз в 15–60 минут, с курсором `lastSyncedAt`;
5. мониторинг: журнал модуля + алерт на 401/403 (истёк токен или scope).
