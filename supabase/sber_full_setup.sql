-- Полная подготовка БД для автоматической синхронизации Sber API -> Supabase
-- Выполнить один раз в Supabase SQL Editor (аддитивно, существующие данные не удаляются/не перезаписываются)

-- 1. Метка источника данных (Sber/CSV/manual)
alter table public.transactions
  add column if not exists data_source text;

-- снять старый check, если был, и поставить нужный (безопасно переопределить)
alter table public.transactions
  drop constraint if exists transactions_data_source_check;

alter table public.transactions
  add constraint transactions_data_source_check
  check (data_source in ('csv', 'sber_api', 'manual'));

alter table public.transactions
  alter column data_source set default 'csv';

-- проставить источник для уже существующих записей без метки
update public.transactions
set data_source = 'csv'
where data_source is null;

-- 2. Дедупликация Sber-операций (нужна для upsert/автосинхронизации, без дублей)
drop index if exists public.transactions_sber_dedup_idx;

create unique index transactions_sber_dedup_idx
  on public.transactions (fund_id, bank_transaction_id);

-- 3. Журнал запусков синхронизации
create table if not exists public.sber_sync_runs (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  fetched integer not null default 0,
  inserted integer not null default 0,
  duplicates integer not null default 0,
  status text not null default 'running' check (status in ('running','success','failed')),
  error text
);

alter table public.sber_sync_runs enable row level security;
