-- Safe Sber API integration: additive only, no CSV data changes
alter table public.transactions
  add column if not exists data_source text
  check (data_source in ('csv','sber_api','manual'))
  default 'csv';

drop index if exists public.transactions_sber_dedup_idx;
create unique index if not exists transactions_sber_dedup_idx
  on public.transactions (fund_id, bank_transaction_id)
  where bank_transaction_id is not null;

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

-- Комментарий для CSV: существующие записи получают data_source='csv' автоматически
-- через DEFAULT. Ручные записи, созданные до миграции, останутся 'csv' — это не
-- критично (historical data), при необходимости обновить вручную:
--   update transactions set data_source='manual' where bank_transaction_id is null;

-- RLС: доступ к таблице sber_sync_runs только для authenticated
alter table public.sber_sync_runs enable row level security;
