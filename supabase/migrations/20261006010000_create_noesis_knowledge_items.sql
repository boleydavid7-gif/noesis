create table if not exists public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'note',
  title text not null,
  source_url text,
  notes text,
  content text,
  status text not null default 'ready',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.knowledge_items add column if not exists kind text not null default 'note';
alter table public.knowledge_items add column if not exists title text not null default 'Quick note';
alter table public.knowledge_items add column if not exists source_url text;
alter table public.knowledge_items add column if not exists notes text;
alter table public.knowledge_items add column if not exists content text;
alter table public.knowledge_items add column if not exists status text not null default 'ready';
alter table public.knowledge_items add column if not exists created_at timestamptz not null default now();
alter table public.knowledge_items add column if not exists updated_at timestamptz not null default now();

grant select, insert, update, delete on public.knowledge_items to authenticated;
alter table public.knowledge_items enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'knowledge_items'
      and policyname = 'Noesis users manage their own knowledge items'
  ) then
    create policy "Noesis users manage their own knowledge items"
      on public.knowledge_items for all to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create index if not exists knowledge_items_user_created_idx
  on public.knowledge_items (user_id, created_at desc);

create or replace function public.noesis_update_knowledge_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists noesis_knowledge_items_updated_at on public.knowledge_items;
create trigger noesis_knowledge_items_updated_at
  before update on public.knowledge_items
  for each row execute function public.noesis_update_knowledge_updated_at();
