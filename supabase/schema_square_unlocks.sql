-- xuxuxu square unlock economy schema (optional but recommended)
-- Run this in Supabase SQL editor after schema_v1.sql.

create table if not exists public.user_wallets (
  user_id uuid primary key,
  balance int not null default 600,
  total_spent int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_wallets_balance_non_negative check (balance >= 0),
  constraint user_wallets_spent_non_negative check (total_spent >= 0)
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_character_id uuid references public.characters(id) on delete set null,
  local_character_id uuid references public.characters(id) on delete set null,
  kind text not null,
  amount int not null,
  reason text not null default '',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint wallet_transactions_kind check (kind in ('credit', 'debit', 'refund')),
  constraint wallet_transactions_amount_positive check (amount > 0)
);

create index if not exists wallet_transactions_user_idx on public.wallet_transactions(user_id, created_at desc);
create index if not exists wallet_transactions_source_idx on public.wallet_transactions(source_character_id);

create table if not exists public.square_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_character_id uuid not null references public.characters(id) on delete cascade,
  local_character_id uuid references public.characters(id) on delete set null,
  price_coins int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint square_unlocks_price_non_negative check (price_coins >= 0),
  unique (user_id, source_character_id)
);

create index if not exists square_unlocks_user_idx on public.square_unlocks(user_id, created_at desc);
create index if not exists square_unlocks_source_idx on public.square_unlocks(source_character_id);

alter table public.user_wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.square_unlocks enable row level security;

drop policy if exists "user_wallets_owner_all" on public.user_wallets;
create policy "user_wallets_owner_all" on public.user_wallets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "wallet_transactions_owner_all" on public.wallet_transactions;
create policy "wallet_transactions_owner_all" on public.wallet_transactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "square_unlocks_owner_all" on public.square_unlocks;
create policy "square_unlocks_owner_all" on public.square_unlocks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.parse_unlock_price(p_settings jsonb)
returns int
language plpgsql
stable
as $$
declare
  v_price int := 0;
  v_raw text := '';
begin
  v_raw := coalesce(p_settings ->> 'unlock_price_coins', '');
  if v_raw ~ '^\d+$' then
    v_price := v_raw::int;
  else
    v_raw := coalesce(p_settings -> 'creation_form' -> 'publish' ->> 'unlock_price_coins', '');
    if v_raw ~ '^\d+$' then
      v_price := v_raw::int;
    end if;
  end if;

  if v_price < 0 then
    v_price := 0;
  end if;
  if v_price > 200000 then
    v_price := 200000;
  end if;
  return v_price;
end;
$$;

create or replace function public.get_wallet_summary()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_balance int := 0;
  v_spent int := 0;
  v_unlocked int := 0;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  end if;

  insert into public.user_wallets (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select balance, total_spent
  into v_balance, v_spent
  from public.user_wallets
  where user_id = v_user_id;

  select count(*)
  into v_unlocked
  from public.square_unlocks
  where user_id = v_user_id;

  return jsonb_build_object(
    'ok', true,
    'wallet_ready', true,
    'balance', coalesce(v_balance, 0),
    'total_spent', coalesce(v_spent, 0),
    'total_unlocked', coalesce(v_unlocked, 0)
  );
end;
$$;

create or replace function public.unlock_public_character(p_source_character_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_source public.characters%rowtype;
  v_unlock public.square_unlocks%rowtype;
  v_wallet public.user_wallets%rowtype;
  v_local_character_id uuid;
  v_price int := 0;
  v_share_raw text := '';
  v_creator_share_bp int := 7000;
  v_creator_gain int := 0;
  v_platform_fee int := 0;
  v_now timestamptz := now();
  v_settings jsonb := '{}'::jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  end if;
  if p_source_character_id is null then
    return jsonb_build_object('ok', false, 'error', 'MISSING_SOURCE_ID');
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_source_character_id::text));

  select *
  into v_unlock
  from public.square_unlocks
  where user_id = v_user_id
    and source_character_id = p_source_character_id
  limit 1;

  if found and v_unlock.local_character_id is not null then
    insert into public.user_wallets (user_id)
    values (v_user_id)
    on conflict (user_id) do nothing;

    select *
    into v_wallet
    from public.user_wallets
    where user_id = v_user_id;

    return jsonb_build_object(
      'ok', true,
      'wallet_ready', true,
      'already_unlocked', true,
      'local_character_id', v_unlock.local_character_id,
      'charged_coins', 0,
      'price_coins', coalesce(v_unlock.price_coins, 0),
      'balance_after', coalesce(v_wallet.balance, 0),
      'creator_gain', 0,
      'platform_fee', 0
    );
  end if;

  select *
  into v_source
  from public.characters
  where id = p_source_character_id
    and visibility = 'public'
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'SOURCE_NOT_PUBLIC');
  end if;

  v_price := public.parse_unlock_price(coalesce(v_source.settings, '{}'::jsonb));
  v_share_raw := coalesce(v_source.settings ->> 'unlock_creator_share_bp', '');
  if not (v_share_raw ~ '^\d+$') then
    v_share_raw := coalesce(v_source.settings -> 'creation_form' -> 'publish' ->> 'unlock_creator_share_bp', '');
  end if;
  if v_share_raw ~ '^\d+$' then
    v_creator_share_bp := v_share_raw::int;
  end if;
  if v_creator_share_bp < 0 then
    v_creator_share_bp := 0;
  end if;
  if v_creator_share_bp > 10000 then
    v_creator_share_bp := 10000;
  end if;

  insert into public.user_wallets (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select *
  into v_wallet
  from public.user_wallets
  where user_id = v_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'WALLET_INIT_FAILED');
  end if;

  if v_wallet.balance < v_price then
    return jsonb_build_object(
      'ok', false,
      'error', 'INSUFFICIENT_COINS',
      'balance', v_wallet.balance,
      'price_coins', v_price
    );
  end if;

  v_settings := coalesce(v_source.settings, '{}'::jsonb);
  if lower(coalesce(v_settings ->> 'age_mode', '')) = 'teen' or lower(coalesce(v_settings ->> 'teen_mode', 'false')) = 'true' then
    v_settings := v_settings || jsonb_build_object(
      'teen_mode', true,
      'age_mode', 'teen',
      'romance_mode', 'ROMANCE_OFF'
    );
  end if;

  v_settings := v_settings || jsonb_build_object(
    'source_character_id', p_source_character_id,
    'unlocked_from_square', true,
    'activated', true,
    'home_hidden', false,
    'activated_at', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'activated_order', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
  );

  insert into public.characters (
    user_id,
    name,
    system_prompt,
    visibility,
    profile,
    settings
  ) values (
    v_user_id,
    v_source.name,
    v_source.system_prompt,
    'private',
    coalesce(v_source.profile, '{}'::jsonb),
    v_settings
  )
  returning id into v_local_character_id;

  if found then
    update public.square_unlocks
    set
      local_character_id = v_local_character_id,
      price_coins = v_price,
      updated_at = now()
    where user_id = v_user_id
      and source_character_id = p_source_character_id;

    if not found then
      insert into public.square_unlocks (
        user_id,
        source_character_id,
        local_character_id,
        price_coins
      ) values (
        v_user_id,
        p_source_character_id,
        v_local_character_id,
        v_price
      );
    end if;
  end if;

  if v_price > 0 then
    if v_source.user_id is not null and v_source.user_id <> v_user_id then
      v_creator_gain := floor((v_price::numeric * v_creator_share_bp::numeric) / 10000)::int;
      if v_creator_gain < 0 then
        v_creator_gain := 0;
      end if;
      if v_creator_gain > v_price then
        v_creator_gain := v_price;
      end if;
    else
      v_creator_gain := 0;
    end if;
    v_platform_fee := v_price - v_creator_gain;

    update public.user_wallets
    set
      balance = balance - v_price,
      total_spent = total_spent + v_price,
      updated_at = now()
    where user_id = v_user_id
    returning * into v_wallet;

    insert into public.wallet_transactions (
      user_id,
      source_character_id,
      local_character_id,
      kind,
      amount,
      reason,
      meta
    ) values (
      v_user_id,
      p_source_character_id,
      v_local_character_id,
      'debit',
      v_price,
      'square_unlock',
      jsonb_build_object(
        'source_character_id', p_source_character_id,
        'creator_user_id', v_source.user_id,
        'creator_share_bp', v_creator_share_bp,
        'creator_gain', v_creator_gain,
        'platform_fee', v_platform_fee
      )
    );

    if v_creator_gain > 0 and v_source.user_id is not null and v_source.user_id <> v_user_id then
      insert into public.user_wallets (user_id)
      values (v_source.user_id)
      on conflict (user_id) do nothing;

      update public.user_wallets
      set
        balance = balance + v_creator_gain,
        updated_at = now()
      where user_id = v_source.user_id;

      insert into public.wallet_transactions (
        user_id,
        source_character_id,
        local_character_id,
        kind,
        amount,
        reason,
        meta
      ) values (
        v_source.user_id,
        p_source_character_id,
        v_local_character_id,
        'credit',
        v_creator_gain,
        'square_unlock_sale',
        jsonb_build_object(
          'source_character_id', p_source_character_id,
          'buyer_user_id', v_user_id,
          'buyer_paid', v_price,
          'creator_share_bp', v_creator_share_bp,
          'platform_fee', v_platform_fee
        )
      );
    end if;
  else
    v_creator_gain := 0;
    v_platform_fee := 0;
    update public.user_wallets
    set updated_at = now()
    where user_id = v_user_id
    returning * into v_wallet;
  end if;

  return jsonb_build_object(
    'ok', true,
    'wallet_ready', true,
    'already_unlocked', false,
    'local_character_id', v_local_character_id,
    'charged_coins', v_price,
    'price_coins', v_price,
    'balance_after', coalesce(v_wallet.balance, 0),
    'creator_gain', v_creator_gain,
    'platform_fee', v_platform_fee
  );
end;
$$;

grant execute on function public.get_wallet_summary() to authenticated;
grant execute on function public.unlock_public_character(uuid) to authenticated;
