-- xuxuxu feed reactions schema (optional but recommended)
-- Run this in Supabase SQL editor after schema_v1.sql.

create table if not exists public.feed_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  message_id uuid not null references public.messages(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  liked boolean not null default false,
  saved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, message_id),
  constraint feed_reactions_non_empty check (liked = true or saved = true)
);

create index if not exists feed_reactions_user_idx on public.feed_reactions(user_id);
create index if not exists feed_reactions_char_idx on public.feed_reactions(character_id);
create index if not exists feed_reactions_updated_idx on public.feed_reactions(updated_at desc);

alter table public.feed_reactions enable row level security;

drop policy if exists "feed_reactions_owner_all" on public.feed_reactions;
create policy "feed_reactions_owner_all" on public.feed_reactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
