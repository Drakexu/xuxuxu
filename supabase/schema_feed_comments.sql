-- xuxuxu feed comments schema (optional but recommended)
-- Run this in Supabase SQL editor after schema_v1.sql.

create table if not exists public.feed_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  message_id uuid not null references public.messages(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feed_comments_content_len check (char_length(content) >= 1 and char_length(content) <= 300)
);

create index if not exists feed_comments_user_idx on public.feed_comments(user_id);
create index if not exists feed_comments_message_idx on public.feed_comments(message_id);
create index if not exists feed_comments_created_idx on public.feed_comments(created_at desc);

alter table public.feed_comments enable row level security;

drop policy if exists "feed_comments_owner_all" on public.feed_comments;
create policy "feed_comments_owner_all" on public.feed_comments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
