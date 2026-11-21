-- Charity Finance — схема Supabase (полная версия)
-- Выполните этот файл в Supabase → SQL Editor один раз.

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ═══════════════════════════════════════════════════════════════
-- 1. ФОНДЫ (funds)
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.funds (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.funds (id, name, description)
values (
  '00000000-0000-0000-0000-000000000001',
  'Фонд имени Абдуллахажи Урахинского',
  'Прозрачная помощь тем, кто в ней нуждается.'
) on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════════
-- 2. КАТЕГОРИИ (categories)
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  fund_id     uuid not null references public.funds(id) on delete cascade,
  name        text not null,
  type        text not null check (type in ('income', 'expense')),
  description text,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists categories_fund_id_idx on public.categories (fund_id);
create index if not exists categories_type_idx on public.categories (type);
create index if not exists transactions_is_public_idx on public.transactions (is_public);
create index if not exists transactions_date_idx on public.transactions (transaction_date);
create index if not exists transactions_fund_id_idx on public.transactions (fund_id);

insert into public.categories (fund_id, name, type, description, sort_order) values
  ('00000000-0000-0000-0000-000000000001', 'Гранты',            'income',  'Грантовые поступления', 10),
  ('00000000-0000-0000-0000-000000000001', 'Пожертвования',     'income',  'Частные пожертвования', 20),
  ('00000000-0000-0000-0000-000000000001', 'Корпоративные взносы', 'income', 'Взносы от компаний', 25),
  ('00000000-0000-0000-0000-000000000001', 'Мероприятия',       'income',  'Сборы на мероприятиях', 30),
  ('00000000-0000-0000-0000-000000000001', 'Программы',         'expense', 'Программные расходы', 40),
  ('00000000-0000-0000-0000-000000000001', 'Офис и хозяйство',  'expense', 'Офисные расходы', 50),
  ('00000000-0000-0000-0000-000000000001', 'Команда',           'expense', 'Зарплаты и подрядчики', 60),
  ('00000000-0000-0000-0000-000000000001', 'Прочие расходы',    'expense', 'Прочие операционные расходы', 70)
on conflict do nothing;

-- ═══════════════════════════════════════════════════════════════
-- 3. БАНКОВСКИЕ СЧЁТА ФОНДА (bank_accounts)
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.bank_accounts (
  id                    uuid primary key default gen_random_uuid(),
  fund_id               uuid not null references public.funds(id) on delete cascade,
  bank_name             text not null,
  account_name          text not null,
  account_number_masked text not null,
  currency              text not null default 'RUB',
  is_active             boolean not null default true,
  is_default            boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists bank_accounts_fund_id_idx on public.bank_accounts (fund_id);

-- ═══════════════════════════════════════════════════════════════
-- 4. ФИНАНСОВЫЕ ОПЕРАЦИИ (transactions)
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.transactions (
  id                       uuid primary key default gen_random_uuid(),
  fund_id                  uuid not null references public.funds(id) on delete cascade default public.current_fund_id(),
  user_id                  uuid not null references auth.users(id) on delete set null default auth.uid(),
  transaction_date         timestamptz not null default now(),
  type                     text not null check (type in ('income', 'expense')) default 'expense',
  amount                   numeric(14, 2) not null check (amount > 0),
  currency                 text not null default 'RUB',
  description              text not null default '',
  category_id              uuid references public.categories(id) on delete set null,
  -- Банковские данные отправителя
  sender_name              text,
  sender_bank              text,
  sender_account_masked    text,
  -- Банковские данные получателя
  recipient_name           text,
  recipient_bank           text,
  recipient_account_masked text,
  -- Источник поступления
  source_type              text check (source_type in ('donation', 'grant', 'corporate', 'event', 'membership', 'other')),
  -- Дополнительно
  comment                  text,
  -- Документы
  document_name            text,
  document_path            text,
  document_status          text not null default 'missing' check (document_status in ('attached', 'missing', 'expected')),
  -- Банковский ID операции
  bank_transaction_id      text,
  -- Способ оплаты/поступления
  payment_method           text check (payment_method in ('transfer', 'cash', 'spisanie')),
  -- Публикация на публичной странице прозрачности
  is_public                boolean not null default true,
  -- Источник данных (CSV / Sber API / ручной ввод)
  data_source              text check (data_source in ('csv', 'sber_api', 'manual')) default 'csv',
  -- Системные
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists transactions_fund_id_idx on public.transactions (fund_id);
create index if not exists transactions_user_id_idx on public.transactions (user_id);
create index if not exists transactions_date_idx on public.transactions (transaction_date desc);
-- Композитный индекс для быстрых выборок операций фонда за период (без OFFSET-таймаутов)
create index if not exists transactions_fund_date_idx on public.transactions (fund_id, transaction_date desc);
create index if not exists transactions_fund_date_type_idx on public.transactions (fund_id, transaction_date desc, type);
create index if not exists transactions_type_idx on public.transactions (type);
create index if not exists transactions_category_id_idx on public.transactions (category_id);
create index if not exists transactions_bank_txn_id_idx on public.transactions (bank_transaction_id);

-- Дедупликация банковских операций (Sber API и др.) по (fund_id, bank_transaction_id)
drop index if exists public.transactions_sber_dedup_idx;
create unique index if not exists transactions_sber_dedup_idx
  on public.transactions (fund_id, bank_transaction_id)
  where bank_transaction_id is not null;

-- ═══════════════════════════════════════════════════════════════
-- 5. ДОКУМЕНТЫ (documents)
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  fund_id         uuid not null references public.funds(id) on delete cascade,
  transaction_id  uuid not null references public.transactions(id) on delete cascade,
  name            text not null,
  storage_path    text not null,
  mime_type       text not null,
  size_bytes      bigint not null,
  uploaded_by     uuid not null references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists documents_fund_id_idx on public.documents (fund_id);
create index if not exists documents_transaction_id_idx on public.documents (transaction_id);

-- ═══════════════════════════════════════════════════════════════
-- 6. ОРГАНИЗАЦИЯ (organization)
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.organization (
  id           integer primary key default 1 check (id = 1),
  fund_id      uuid not null references public.funds(id) on delete cascade,
  name         text not null default '',
  mission      text not null default '',
  inn          text not null default '',
  ogrn         text not null default '',
  address      text not null default '',
  phone        text not null default '',
  email        text not null default '',
  website      text not null default '',
  donation_url text not null default '',
  updated_at   timestamptz not null default now()
);

insert into public.organization (id, fund_id, name, mission)
values (1, '00000000-0000-0000-0000-000000000001', 'Фонд имени Абдуллахажи Урахинского', 'Прозрачная помощь тем, кто в ней нуждается.')
on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════════
-- 7. СВЯЗИ ПОЛЬЗОВАТЕЛЬ-ФОНД (user_funds)
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.user_funds (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  fund_id   uuid not null references public.funds(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, fund_id)
);

-- 7a. Журнал прогонов синхронизации Sber (sber_sync_runs)
create table if not exists public.sber_sync_runs (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  fetched integer not null default 0,
  inserted integer not null default 0,
  duplicates integer not null default 0,
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  error text
);

alter table public.sber_sync_runs enable row level security;

-- ═══════════════════════════════════════════════════════════════
-- 8. ФУНКЦИЯ updated_at
-- ═══════════════════════════════════════════════════════════════
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists funds_touch on public.funds;
create trigger funds_touch before update on public.funds for each row execute function public.touch_updated_at();

drop trigger if exists categories_touch on public.categories;
create trigger categories_touch before update on public.categories for each row execute function public.touch_updated_at();

drop trigger if exists bank_accounts_touch on public.bank_accounts;
create trigger bank_accounts_touch before update on public.bank_accounts for each row execute function public.touch_updated_at();

drop trigger if exists transactions_touch on public.transactions;
create trigger transactions_touch before update on public.transactions for each row execute function public.touch_updated_at();

drop trigger if exists organization_touch on public.organization;
create trigger organization_touch before update on public.organization for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 9. ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════
alter table public.funds            enable row level security;
alter table public.categories       enable row level security;
alter table public.bank_accounts    enable row level security;
alter table public.transactions     enable row level security;
alter table public.documents        enable row level security;
alter table public.organization     enable row level security;
alter table public.user_funds       enable row level security;

create or replace function public.current_fund_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    (select fund_id from public.user_funds where user_id = auth.uid() and is_active = true limit 1),
    '00000000-0000-0000-0000-000000000001'::uuid
  );
$$;

-- Политики user_funds
drop policy if exists "user_funds_auth_all" on public.user_funds;
create policy "user_funds_auth_all" on public.user_funds
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Политики funds
drop policy if exists "funds_auth_select" on public.funds;
create policy "funds_auth_select" on public.funds
  for select to anon, authenticated
  using (id = public.current_fund_id());

-- Политики categories
drop policy if exists "categories_fund_isolation" on public.categories;
create policy "categories_fund_isolation" on public.categories
  for all to anon, authenticated
  using (fund_id = public.current_fund_id())
  with check (fund_id = public.current_fund_id());

-- Политики bank_accounts
drop policy if exists "bank_accounts_fund_isolation" on public.bank_accounts;
create policy "bank_accounts_fund_isolation" on public.bank_accounts
  for all to anon, authenticated
  using (fund_id = public.current_fund_id())
  with check (fund_id = public.current_fund_id());

-- Политики transactions
drop policy if exists "transactions_fund_isolation" on public.transactions;
create policy "transactions_fund_isolation" on public.transactions
  for all to anon, authenticated
  using (fund_id = public.current_fund_id())
  with check (fund_id = public.current_fund_id());

-- Политики documents
drop policy if exists "documents_fund_isolation" on public.documents;
create policy "documents_fund_isolation" on public.documents
  for all to anon, authenticated
  using (fund_id = public.current_fund_id())
  with check (fund_id = public.current_fund_id());

-- Политики organization
drop policy if exists "organization_fund_isolation" on public.organization;
create policy "organization_fund_isolation" on public.organization
  for all to anon, authenticated
  using (fund_id = public.current_fund_id())
  with check (fund_id = public.current_fund_id());

-- ═══════════════════════════════════════════════════════════════
-- 10. ПРЕДСТАВЛЕНИЯ ДЛЯ ОТЧЁТОВ
-- ═══════════════════════════════════════════════════════════════
drop view if exists public.fund_summary;
create view public.fund_summary as
select
  f.id as fund_id,
  f.name as fund_name,
  coalesce(sum(case when t.type = 'income'  then t.amount else 0 end), 0) as total_income,
  coalesce(sum(case when t.type = 'expense' then t.amount else 0 end), 0) as total_expense,
  coalesce(sum(case when t.type = 'income'  then t.amount else -t.amount end), 0) as balance,
  count(*) as operations_count
from public.funds f
left join public.transactions t on t.fund_id = f.id
group by f.id, f.name;

grant select on public.fund_summary to authenticated;

drop view if exists public.income_by_source;
create view public.income_by_source as
select
  t.fund_id,
  t.source_type,
  coalesce(sum(t.amount), 0) as total_amount,
  count(*) as count
from public.transactions t
where t.type = 'income'
group by t.fund_id, t.source_type;

grant select on public.income_by_source to authenticated;

drop view if exists public.expenses_by_category;
create view public.expenses_by_category as
select
  t.fund_id,
  c.name as category_name,
  c.type as category_type,
  coalesce(sum(t.amount), 0) as total_amount,
  count(*) as count
from public.transactions t
left join public.categories c on c.id = t.category_id
where t.type = 'expense'
group by t.fund_id, c.name, c.type;

grant select on public.expenses_by_category to authenticated;

drop view if exists public.monthly_stats;
create view public.monthly_stats as
select
  t.fund_id,
  date_trunc('month', t.transaction_date) as month,
  coalesce(sum(case when t.type = 'income'  then t.amount else 0 end), 0) as income,
  coalesce(sum(case when t.type = 'expense' then t.amount else 0 end), 0) as expense,
  coalesce(sum(case when t.type = 'income'  then t.amount else -t.amount end), 0) as net,
  count(*) as operations
from public.transactions t
group by t.fund_id, date_trunc('month', t.transaction_date)
order by month desc;

grant select on public.monthly_stats to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 11. ПУБЛИЧНЫЕ ПРЕДСТАВЛЕНИЯ (только is_public = true)
-- ═══════════════════════════════════════════════════════════════
drop view if exists public.public_stats;
create view public.public_stats as
select
  coalesce(sum(case when type = 'income'  then amount else 0 end), 0) as donations,
  coalesce(sum(case when type = 'expense' then amount else 0 end), 0) as expenses,
  coalesce(sum(case when type = 'income'  then amount else -amount end), 0) as balance,
  count(*) as operations
from public.transactions
where is_public = true;

drop view if exists public.public_monthly;
create view public.public_monthly as
select
  to_char(date_trunc('month', transaction_date), 'YYYY-MM') as month,
  coalesce(sum(case when type = 'income'  then amount else 0 end), 0) as donations,
  coalesce(sum(case when type = 'expense' then amount else 0 end), 0) as expenses
from public.transactions
where is_public = true
group by 1
order by 1;

drop view if exists public.public_transactions;
create view public.public_transactions as
select
  t.id,
  to_char(t.transaction_date, 'YYYY-MM-DD') as date,
  substring(t.transaction_date::text from 12 for 5) as time,
  t.type,
  t.category_id,
  c.name as category,
  t.description,
  t.sender_name as donor,
  t.amount,
  t.document_name as doc,
  t.document_status,
  t.payment_method,
  t.is_public
from public.transactions t
left join public.categories c on c.id = t.category_id
where t.is_public = true;

grant select on public.public_transactions to anon, authenticated;

drop view if exists public.public_organization;
create view public.public_organization as
select name, mission, inn, ogrn, address, phone, email, website, donation_url
from public.organization
where id = 1;

grant select on public.public_stats        to anon, authenticated;
grant select on public.public_monthly      to anon, authenticated;
grant select on public.public_transactions to anon, authenticated;
grant select on public.public_organization to anon, authenticated;

-- Мгновенная очистка операций фонда (для миллионов строк)
-- TRUNCATE — метаданные, обычно выполняется мгновенно; обходим statement timeout сессии.
-- Документы (documents) удаляются каскадно, файлы в Storage не удаляются.
create or replace function public.delete_fund_transactions(p_fund_id uuid default public.current_fund_id())
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  if p_fund_id is null then
    raise exception 'fund_id is required';
  end if;
  if p_fund_id is distinct from public.current_fund_id() then
    raise exception 'not allowed';
  end if;
  perform set_config('statement_timeout', '0', true);
  perform set_config('lock_timeout', '10s', true);
  select count(*) into v_count from public.transactions t where t.fund_id = p_fund_id;
  truncate table public.transactions restart identity cascade;
  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.delete_fund_transactions(uuid) to authenticated;
