create table if not exists public.app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;
grant select, insert, update, delete on public.app_state to service_role;
