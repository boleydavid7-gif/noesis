-- Passkeys and review reminders with Noesis closed.
--
-- Passkeys: the learner, signed in, adds a passkey; its public key is kept here so the Worker can check a passkey's
-- signature when it signs in (`/api/passkey/*`, using the service role). Challenges are made and taken by the Worker.
--
-- Review reminders: each device that turns reminders on leaves its push address and when its next review card is
-- due. The Worker's schedule (every 15 minutes) sends an empty push when that time has come, at most once a day.
-- Nothing about the cards themselves is stored.

create table if not exists public.noesis_passkeys (
  credential_id text primary key check (char_length(credential_id) <= 1400),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  public_key text not null check (char_length(public_key) <= 2000),
  algorithm integer not null check (algorithm in (-7, -257)),
  rp_id text not null check (char_length(rp_id) <= 253),
  label text check (char_length(label) <= 100),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

grant select, insert, delete on public.noesis_passkeys to authenticated;
alter table public.noesis_passkeys enable row level security;

drop policy if exists "Noesis users manage their own passkeys" on public.noesis_passkeys;
create policy "Noesis users manage their own passkeys" on public.noesis_passkeys
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.noesis_passkey_challenges (
  challenge text primary key check (char_length(challenge) <= 100),
  expires_at timestamptz not null default now() + interval '2 minutes'
);
alter table public.noesis_passkey_challenges enable row level security;

create table if not exists public.noesis_review_push (
  endpoint text primary key check (char_length(endpoint) <= 1000),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  next_review_at timestamptz,
  last_sent_at timestamptz,
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.noesis_review_push to authenticated;
alter table public.noesis_review_push enable row level security;

drop policy if exists "Noesis users manage their own reminders" on public.noesis_review_push;
create policy "Noesis users manage their own reminders" on public.noesis_review_push
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists noesis_review_push_due on public.noesis_review_push (next_review_at);
