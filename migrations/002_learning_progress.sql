-- Crack SQL V2 cloud progress migration.
-- Safe to run repeatedly in the Supabase SQL editor.

create table if not exists public.learning_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{"version":2,"resetAt":0,"entries":{}}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.learning_progress enable row level security;

drop policy if exists "Users can read own learning progress" on public.learning_progress;
create policy "Users can read own learning progress"
  on public.learning_progress for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own learning progress" on public.learning_progress;
create policy "Users can insert own learning progress"
  on public.learning_progress for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own learning progress" on public.learning_progress;
create policy "Users can update own learning progress"
  on public.learning_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.merge_learning_progress(
  incoming jsonb,
  expected_user uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  stored jsonb;
  merged_entries jsonb := '{}'::jsonb;
  merged_state jsonb;
  merged_reset bigint;
  item record;
  existing_entry jsonb;
  incoming_entry jsonb;
  existing_updated bigint;
  incoming_updated bigint;
begin
  if actor is null or actor <> expected_user then
    raise exception 'The authenticated user does not match expected_user';
  end if;

  if jsonb_typeof(incoming) <> 'object'
     or coalesce((incoming ->> 'version')::integer, 0) <> 2
     or jsonb_typeof(coalesce(incoming -> 'entries', '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid Crack SQL progress payload';
  end if;

  insert into public.learning_progress (user_id)
  values (actor)
  on conflict (user_id) do nothing;

  select state into stored
  from public.learning_progress
  where user_id = actor
  for update;

  stored := coalesce(stored, '{"version":2,"resetAt":0,"entries":{}}'::jsonb);
  merged_reset := greatest(
    coalesce((stored ->> 'resetAt')::bigint, 0),
    coalesce((incoming ->> 'resetAt')::bigint, 0)
  );

  for item in
    select value as key from jsonb_object_keys(coalesce(stored -> 'entries', '{}'::jsonb)) as value
    union
    select value as key from jsonb_object_keys(coalesce(incoming -> 'entries', '{}'::jsonb)) as value
  loop
    existing_entry := stored -> 'entries' -> item.key;
    incoming_entry := incoming -> 'entries' -> item.key;
    existing_updated := coalesce((existing_entry ->> 'updatedAt')::bigint, 0);
    incoming_updated := coalesce((incoming_entry ->> 'updatedAt')::bigint, 0);

    if greatest(existing_updated, incoming_updated) <= merged_reset then
      continue;
    end if;

    if incoming_updated >= existing_updated then
      merged_entries := jsonb_set(merged_entries, array[item.key], incoming_entry, true);
    else
      merged_entries := jsonb_set(merged_entries, array[item.key], existing_entry, true);
    end if;
  end loop;

  merged_state := jsonb_build_object(
    'version', 2,
    'resetAt', merged_reset,
    'entries', merged_entries
  );

  update public.learning_progress
  set state = merged_state, updated_at = now()
  where user_id = actor;

  return merged_state;
end;
$$;

revoke all on function public.merge_learning_progress(jsonb, uuid) from public;
grant execute on function public.merge_learning_progress(jsonb, uuid) to authenticated;
