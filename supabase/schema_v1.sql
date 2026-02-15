-- xuxuxu v1 schema (run in Supabase SQL editor).
-- This file is idempotent-ish but may require manual review if you already have tables.

-- 1) characters: add columns used by v1 (safe to run even if some already exist)
alter table if exists public.characters
  add column if not exists profile jsonb default '{}'::jsonb,
  add column if not exists settings jsonb default '{}'::jsonb,
  add column if not exists visibility text default 'private';

-- 2) conversations/messages: add input_event to messages (optional)
alter table if exists public.messages
  add column if not exists input_event text;

-- 3) state snapshots
create table if not exists public.conversation_states (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  user_id uuid not null,
  character_id uuid not null references public.characters(id) on delete cascade,
  state jsonb not null,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

create index if not exists conversation_states_user_idx on public.conversation_states(user_id);
create index if not exists conversation_states_char_idx on public.conversation_states(character_id);

create table if not exists public.character_states (
  character_id uuid primary key references public.characters(id) on delete cascade,
  user_id uuid not null,
  state jsonb not null,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

create index if not exists character_states_user_idx on public.character_states(user_id);

-- 3b) PatchScribe jobs (async patching, non-blocking chat)
create table if not exists public.patch_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  turn_seq int not null default 0,
  patch_input jsonb not null,
  status text not null default 'pending', -- pending|processing|done|failed
  attempts int not null default 0,
  last_error text not null default '',
  patched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, turn_seq)
);

create index if not exists patch_jobs_conv_idx on public.patch_jobs(conversation_id);
create index if not exists patch_jobs_status_idx on public.patch_jobs(status);

-- 4) memory B episodes (10-min buckets)
create table if not exists public.memory_b_episodes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  bucket_start timestamptz not null,
  summary text not null,
  open_loops jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (conversation_id, bucket_start)
);

create index if not exists memory_b_episodes_conv_idx on public.memory_b_episodes(conversation_id);
create index if not exists memory_b_episodes_bucket_idx on public.memory_b_episodes(bucket_start);

-- 4b) memory daily aggregates (C0/C1/C2/C3)
create table if not exists public.memory_daily (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null,
  day_start date not null,
  c0_summary text not null,
  c1_highlights jsonb not null default '[]'::jsonb,
  c2_user_profile text not null,
  c3_role_profile text not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, day_start)
);

create index if not exists memory_daily_conv_idx on public.memory_daily(conversation_id);
create index if not exists memory_daily_day_idx on public.memory_daily(day_start);

-- 4c) memory biweekly aggregates (D)
create table if not exists public.memory_biweekly (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null,
  period_start date not null,
  summary text not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, period_start)
);

create index if not exists memory_biweekly_conv_idx on public.memory_biweekly(conversation_id);
create index if not exists memory_biweekly_period_idx on public.memory_biweekly(period_start);

-- 5) character assets table (optional but recommended for uploads)
create table if not exists public.character_assets (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  user_id uuid not null,
  kind text not null, -- full_body|head|wardrobe|cover
  storage_path text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists character_assets_char_idx on public.character_assets(character_id);

-- ---------------------------
-- RLS policies
-- ---------------------------
alter table public.characters enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_states enable row level security;
alter table public.character_states enable row level security;
alter table public.patch_jobs enable row level security;
alter table public.memory_b_episodes enable row level security;
alter table public.memory_daily enable row level security;
alter table public.memory_biweekly enable row level security;
alter table public.character_assets enable row level security;

-- characters: owner full access
drop policy if exists "characters_owner_all" on public.characters;
create policy "characters_owner_all" on public.characters
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- characters: allow read for public ones (logged-in users)
drop policy if exists "characters_public_read" on public.characters;
create policy "characters_public_read" on public.characters
  for select using (visibility = 'public');

-- conversations/messages: owner-only
drop policy if exists "conversations_owner_all" on public.conversations;
create policy "conversations_owner_all" on public.conversations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "messages_owner_all" on public.messages;
create policy "messages_owner_all" on public.messages
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- snapshots: owner-only
drop policy if exists "conversation_states_owner_all" on public.conversation_states;
create policy "conversation_states_owner_all" on public.conversation_states
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "character_states_owner_all" on public.character_states;
create policy "character_states_owner_all" on public.character_states
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- patch jobs: owner-only
drop policy if exists "patch_jobs_owner_all" on public.patch_jobs;
create policy "patch_jobs_owner_all" on public.patch_jobs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- memory episodes: owner-only (via conversations user_id stored redundantly is not present; we rely on user_id in messages and conv_states)
-- For simplicity, store user_id in memory_b_episodes? If not, keep strict by joining is not possible in RLS.
-- Recommended change: add user_id column. Below we add it and enforce.
alter table if exists public.memory_b_episodes add column if not exists user_id uuid;
update public.memory_b_episodes set user_id = (select user_id from public.conversations c where c.id = memory_b_episodes.conversation_id) where user_id is null;
alter table public.memory_b_episodes alter column user_id set not null;

drop policy if exists "memory_b_episodes_owner_all" on public.memory_b_episodes;
create policy "memory_b_episodes_owner_all" on public.memory_b_episodes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "memory_daily_owner_all" on public.memory_daily;
create policy "memory_daily_owner_all" on public.memory_daily
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "memory_biweekly_owner_all" on public.memory_biweekly;
create policy "memory_biweekly_owner_all" on public.memory_biweekly
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- character assets: owner-only
drop policy if exists "character_assets_owner_all" on public.character_assets;
create policy "character_assets_owner_all" on public.character_assets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------
-- Storage bucket notes (manual, in Supabase dashboard)
-- ---------------------------
-- Create bucket: character-assets
-- Suggested policy:
-- - Allow authenticated users to upload/read objects under path: {auth.uid()}/...
-- - For public characters, you may later add a read policy that allows access to their assets.
