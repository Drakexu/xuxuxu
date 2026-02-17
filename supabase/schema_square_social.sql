-- xuxuxu square social schema (optional but recommended)
-- Run this in Supabase SQL editor after schema_v1.sql.

create table if not exists public.square_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_character_id uuid not null references public.characters(id) on delete cascade,
  liked boolean not null default false,
  saved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_character_id),
  constraint square_reactions_non_empty check (liked = true or saved = true)
);

create index if not exists square_reactions_user_idx on public.square_reactions(user_id, updated_at desc);
create index if not exists square_reactions_source_idx on public.square_reactions(source_character_id, updated_at desc);

create table if not exists public.square_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_character_id uuid not null references public.characters(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint square_comments_content_len check (char_length(content) >= 1 and char_length(content) <= 300)
);

create index if not exists square_comments_user_idx on public.square_comments(user_id, created_at desc);
create index if not exists square_comments_source_idx on public.square_comments(source_character_id, created_at desc);

alter table public.square_reactions enable row level security;
alter table public.square_comments enable row level security;

drop policy if exists "square_reactions_owner_all" on public.square_reactions;
create policy "square_reactions_owner_all" on public.square_reactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "square_comments_owner_all" on public.square_comments;
create policy "square_comments_owner_all" on public.square_comments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
