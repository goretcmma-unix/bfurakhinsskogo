-- Charity Finance — полная схема Supabase с миграциями
-- Выполните этот файл в Supabase → SQL Editor пошагово.

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ═══════════════════════════════════════════════════════════════
-- 1. ФОНДЫ (funds) — для мульти-фоновой поддержки
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.funds (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Стартовый фонд
insert into public.funds (id, name, description)
values (
  '00000000-0000-0000-0000-000000000001',
  'Фонд имени Абдуллахажи Урахинского',
  'Прозрачная помощь тем, кто в ней нуждается.'
) on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════════
-- 2. КАТЕГОРИИ (categories) — с fund_id
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  fund_id    uuid not null references public.funds(id) on delete cascade,
  name       text not null,
  type       text not null check (type in ('income', 'expense')),
  description text,
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists categories_fund_id_idx on public.categories (fund_id);
create index if not exists categories_type_idx on public.categories (type);

-- Стартовые категории для демо-фонда
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
  id                   uuid primary key default gen_random_uuid(),
  fund_id              uuid not null references public.funds(id) on delete cascade,
  bank_name            text not null,
  account_name         text not null,
  account_number_masked text not null,
  currency             text not null default 'RUB',
  is_active            boolean not null default true,
  is_default           boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists bank_accounts_fund_id_idx on public.bank_accounts (fund_id);

-- ═══════════════════════════════════════════════════════════════
-- 4. ФИНАНСОВЫЕ ОПЕРАЦИИ (transactions) — полная структура
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.transactions (
  id                       uuid primary key default gen_random_uuid(),
  fund_id                  uuid not null references public.funds(id) on delete cascade,
  user_id                  uuid not null references auth.users(id) on delete set null,
  transaction_date         timestamptz not null default now(),
  type                     text not null check (type in ('income', 'expense')),
  amount                   numeric(14, 2) not null check (amount > 0),
  currency                 text not null default 'RUB',
  description              text not null default '',
  category_id              uuid references public.categories(id) on delete set null,
  -- Банковские данные отправителя (для импорта выписок)
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
  is_public                boolean not null default false,
  -- Системные
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists transactions_fund_id_idx on public.transactions (fund_id);
create index if not exists transactions_user_id_idx on public.transactions (user_id);
create index if not exists transactions_date_idx on public.transactions (transaction_date desc);
create index if not exists transactions_type_idx on public.transactions (type);
create index if not exists transactions_category_id_idx on public.transactions (category_id);
create index if not exists transactions_bank_txn_id_idx on public.transactions (bank_transaction_id);

-- ═══════════════════════════════════════════════════════════════
-- 5. ДОКУМЕНТЫ (documents) — привязка к операциям
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.documents (
  id                uuid primary key default gen_random_uuid(),
  fund_id           uuid not null references public.funds(id) on delete cascade,
  transaction_id    uuid not null references public.transactions(id) on delete cascade,
  name              text not null,
  storage_path      text not null,
  mime_type         text not null,
  size_bytes        bigint not null,
  uploaded_by       uuid not null references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists documents_fund_id_idx on public.documents (fund_id);
create index if not exists documents_transaction_id_idx on public.documents (transaction_id);

-- ═══════════════════════════════════════════════════════════════
-- 6. ОРГАНИЗАЦИЯ (organization) — реквизиты фонда
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
-- 7. ФУНКЦИЯ updated_at
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
-- 8. ROW LEVEL SECURITY (RLS) — изоляция по fund_id
-- ═══════════════════════════════════════════════════════════════
alter table public.funds            enable row level security;
alter table public.categories       enable row level security;
alter table public.bank_accounts    enable row level security;
alter table public.transactions     enable row level security;
alter table public.documents        enable row level security;
alter table public.organization     enable row level security;

-- Вспомогательная функция: текущий fund_id пользователя
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

-- Таблица связей пользователь-фонд (для мульти-фонов)
create table if not exists public.user_funds (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  fund_id   uuid not null references public.funds(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, fund_id)
);

alter table public.user_funds enable row level security;

drop policy if exists "user_funds_auth_all" on public.user_funds;
create policy "user_funds_auth_all" on public.user_funds
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Политики для funds
drop policy if exists "funds_auth_select" on public.funds;
create policy "funds_auth_select" on public.funds
  for select to authenticated
  using (id = public.current_fund_id());

-- Политики для categories
drop policy if exists "categories_fund_isolation" on public.categories;
create policy "categories_fund_isolation" on public.categories
  for all to authenticated
  using (fund_id = public.current_fund_id())
  with check (fund_id = public.current_fund_id());

-- Политики для bank_accounts
drop policy if exists "bank_accounts_fund_isolation" on public.bank_accounts;
create policy "bank_accounts_fund_isolation" on public.bank_accounts
  for all to authenticated
  using (fund_id = public.current_fund_id())
  with check (fund_id = public.current_fund_id());

-- Политики для transactions
drop policy if exists "transactions_fund_isolation" on public.transactions;
create policy "transactions_fund_isolation" on public.transactions
  for all to authenticated
  using (fund_id = public.current_fund_id())
  with check (fund_id = public.current_fund_id());

-- Политики для documents
drop policy if exists "documents_fund_isolation" on public.documents;
create policy "documents_fund_isolation" on public.documents
  for all to authenticated
  using (fund_id = public.current_fund_id())
  with check (fund_id = public.current_fund_id());

-- Политики для organization
drop policy if exists "organization_fund_isolation" on public.organization;
create policy "organization_fund_isolation" on public.organization
  for all to authenticated
  using (fund_id = public.current_fund_id())
  with check (fund_id = public.current_fund_id());

-- ═══════════════════════════════════════════════════════════════
-- 9. SUPABASE STORAGE — bucket для документов
-- ═══════════════════════════════════════════════════════════════
-- Выполните в Supabase Dashboard → Storage:
-- 1. Создайте bucket: fund-documents (private)
-- 2. Добавьте политики:

/*
-- Политика: пользователи могут загружать документы в свой фонд
create policy "documents_upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fund-documents' and
    (storage.foldername(name))[1] = public.current_fund_id()::text
  );

-- Политика: пользователи могут читать документы своего фонда
create policy "documents_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fund-documents' and
    (storage.foldername(name))[1] = public.current_fund_id()::text
  );

-- Политика: пользователи могут удалять свои документы
create policy "documents_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fund-documents' and
    (storage.foldername(name))[1] = public.current_fund_id()::text and
    owner = auth.uid()
  );
*/

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