-- Noesis Plus and Noema's monthly allowance.
--
-- noesis_plus: one row per person who has subscribed, written only by the Worker's Stripe webhook (service role).
-- A person reads their own row. Nothing about payment details is kept, only Stripe's ids, the plan and its dates.
--
-- noesis_noema_use: how many times Noema has been asked this month, per person. Only the Worker counts, through
-- noesis_take_noema, which adds one and checks the limit in one step, so two questions at once cannot both slip
-- past it. A person reads their own counts.

create table if not exists public.noesis_plus (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null check (char_length(status) <= 40),
  plan text check (plan in ('month', 'year')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  stripe_customer text check (char_length(stripe_customer) <= 100),
  stripe_subscription text check (char_length(stripe_subscription) <= 100),
  updated_at timestamptz not null default now()
);

grant select on public.noesis_plus to authenticated;
alter table public.noesis_plus enable row level security;

drop policy if exists "Noesis users read their own plan" on public.noesis_plus;
create policy "Noesis users read their own plan" on public.noesis_plus
  for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.noesis_noema_use (
  user_id uuid not null references auth.users (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  used integer not null default 0 check (used >= 0),
  primary key (user_id, month)
);

grant select on public.noesis_noema_use to authenticated;
alter table public.noesis_noema_use enable row level security;

drop policy if exists "Noesis users read their own Noema use" on public.noesis_noema_use;
create policy "Noesis users read their own Noema use" on public.noesis_noema_use
  for select to authenticated
  using (auth.uid() = user_id);

-- Adds one use and returns the new count, or null when the month's limit is already reached (nothing is added).
create or replace function public.noesis_take_noema(p_user uuid, p_month text, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  insert into public.noesis_noema_use (user_id, month, used)
  values (p_user, p_month, 1)
  on conflict (user_id, month) do update
    set used = public.noesis_noema_use.used + 1
    where public.noesis_noema_use.used < p_limit
  returning used into next_count;
  return next_count;
end;
$$;

revoke all on function public.noesis_take_noema(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.noesis_take_noema(uuid, text, integer) to service_role;
