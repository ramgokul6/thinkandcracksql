-- Crack SQL admin, usage telemetry and daily challenge foundation.
-- Apply 002_learning_progress.sql before this migration.

create or replace function public.is_crack_sql_admin()
returns boolean
language sql stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'app_role', '') = 'admin';
$$;

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'sign_in','scenario_opened','thinking_scored','sql_generated',
    'scenario_generated','dbfiddle_opened','practice_confirmed','challenge_joined'
  )),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists usage_events_created_at_idx on public.usage_events(created_at desc);
create index if not exists usage_events_user_id_idx on public.usage_events(user_id, created_at desc);
alter table public.usage_events enable row level security;
drop policy if exists "Learners record own usage" on public.usage_events;
create policy "Learners record own usage" on public.usage_events
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Learners read own usage" on public.usage_events;
create policy "Learners read own usage" on public.usage_events
  for select to authenticated using (auth.uid() = user_id or public.is_crack_sql_admin());
grant select, insert on public.usage_events to authenticated;

create table if not exists public.daily_challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 3 and 120),
  prompt text not null check (length(prompt) between 10 and 8000),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  capacity smallint not null default 25 check (capacity = 25),
  prize_inr integer not null default 500 check (prize_inr = 500),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  winner_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists daily_challenges_active_idx on public.daily_challenges(is_active, starts_at, ends_at);
alter table public.daily_challenges enable row level security;
drop policy if exists "Signed-in users read challenges" on public.daily_challenges;
create policy "Signed-in users read challenges" on public.daily_challenges
  for select to authenticated using (true);
drop policy if exists "Admins create challenges" on public.daily_challenges;
create policy "Admins create challenges" on public.daily_challenges
  for insert to authenticated with check (public.is_crack_sql_admin() and created_by = auth.uid());
drop policy if exists "Admins update challenges" on public.daily_challenges;
create policy "Admins update challenges" on public.daily_challenges
  for update to authenticated using (public.is_crack_sql_admin()) with check (public.is_crack_sql_admin());
drop policy if exists "Admins delete challenges" on public.daily_challenges;
create policy "Admins delete challenges" on public.daily_challenges
  for delete to authenticated using (public.is_crack_sql_admin());
grant select, insert, update, delete on public.daily_challenges to authenticated;

create table if not exists public.challenge_entries (
  challenge_id uuid not null references public.daily_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  thinking_text text not null default '',
  sql_text text not null default '',
  joined_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  primary key (challenge_id, user_id),
  check (length(thinking_text) <= 8000),
  check (length(sql_text) <= 12000)
);
alter table public.challenge_entries enable row level security;
drop policy if exists "Participants and admins read entries" on public.challenge_entries;
create policy "Participants and admins read entries" on public.challenge_entries
  for select to authenticated using (auth.uid() = user_id or public.is_crack_sql_admin());
grant select on public.challenge_entries to authenticated;

create or replace function public.join_daily_challenge(challenge_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare c public.daily_challenges%rowtype; seats integer;
begin
  if auth.uid() is null then raise exception 'SIGN_IN_REQUIRED'; end if;
  select * into c from public.daily_challenges where id = challenge_id for update;
  if not found or not c.is_active or c.starts_at > now() or c.ends_at <= now() then
    raise exception 'CHALLENGE_CLOSED';
  end if;
  if exists(select 1 from public.challenge_entries e where e.challenge_id = c.id and e.user_id = auth.uid()) then
    return;
  end if;
  select count(*) into seats from public.challenge_entries where challenge_entries.challenge_id = c.id;
  if seats >= c.capacity then raise exception 'CHALLENGE_FULL'; end if;
  insert into public.challenge_entries(challenge_id,user_id) values(c.id,auth.uid());
end;
$$;
revoke all on function public.join_daily_challenge(uuid) from public;
grant execute on function public.join_daily_challenge(uuid) to authenticated;

create or replace function public.submit_daily_challenge(challenge_id uuid, thinking_text text, sql_text text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare c public.daily_challenges%rowtype;
begin
  if auth.uid() is null then raise exception 'SIGN_IN_REQUIRED'; end if;
  select * into c from public.daily_challenges where id = challenge_id and is_active for share;
  if not found or c.starts_at > now() or c.ends_at <= now() then raise exception 'CHALLENGE_CLOSED'; end if;
  if length(coalesce(thinking_text,'')) > 8000 or length(coalesce(sql_text,'')) > 12000 then
    raise exception 'ENTRY_TOO_LONG';
  end if;
  update public.challenge_entries set thinking_text = coalesce(submit_daily_challenge.thinking_text,''),
    sql_text = coalesce(submit_daily_challenge.sql_text,''), submitted_at = now()
  where challenge_entries.challenge_id = submit_daily_challenge.challenge_id and user_id = auth.uid();
  if not found then raise exception 'JOIN_REQUIRED'; end if;
end;
$$;
revoke all on function public.submit_daily_challenge(uuid,text,text) from public;
grant execute on function public.submit_daily_challenge(uuid,text,text) to authenticated;

create or replace function public.award_daily_challenge(challenge_id uuid, winner_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare c public.daily_challenges%rowtype;
begin
  if not public.is_crack_sql_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into c from public.daily_challenges where id = challenge_id for update;
  if not found or c.ends_at > now() then raise exception 'CHALLENGE_NOT_CLOSED'; end if;
  if not exists(select 1 from public.challenge_entries where challenge_entries.challenge_id = c.id and user_id = winner_id
    and length(btrim(thinking_text)) > 0) then
    raise exception 'WINNER_NOT_A_PARTICIPANT';
  end if;
  if c.winner_user_id is not null and c.winner_user_id <> winner_id then raise exception 'WINNER_ALREADY_SET'; end if;
  update public.daily_challenges set winner_user_id = winner_id where id = c.id;
end;
$$;
revoke all on function public.award_daily_challenge(uuid,uuid) from public;
grant execute on function public.award_daily_challenge(uuid,uuid) to authenticated;

create or replace function public.admin_challenge_entries(challenge_id uuid)
returns table(user_id uuid,email text,thinking_text text,sql_text text,submitted_at timestamptz)
language plpgsql stable security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.is_crack_sql_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  return query
    select e.user_id,u.email,e.thinking_text,e.sql_text,e.submitted_at
    from public.challenge_entries e join auth.users u on u.id=e.user_id
    where e.challenge_id=admin_challenge_entries.challenge_id
    order by e.submitted_at;
end;
$$;
revoke all on function public.admin_challenge_entries(uuid) from public;
grant execute on function public.admin_challenge_entries(uuid) to authenticated;

create or replace function public.admin_dashboard_summary()
returns jsonb
language plpgsql stable security definer
set search_path = public, auth, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_crack_sql_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  with progress_by_user as (
    select p.user_id,
      count(*) as scenarios_started,
      count(*) filter (where nullif(e.value ->> 'externalValidationFingerprint','') is not null) as scenarios_completed,
      round(avg(nullif(e.value -> 'assessment' ->> 'score','')::numeric),1) as average_thinking_score,
      count(*) filter (where coalesce((e.value ->> 'sqlGenerated')::boolean,false)) as sql_generated
    from public.learning_progress p
    cross join lateral jsonb_each(coalesce(p.state -> 'entries','{}'::jsonb)) e
    group by p.user_id
  ), user_rows as (
    select u.id,u.email,u.last_sign_in_at,coalesce(p.scenarios_started,0) scenarios_started,
      coalesce(p.scenarios_completed,0) scenarios_completed,p.average_thinking_score,
      greatest(coalesce((select count(*) from public.usage_events ev where ev.user_id=u.id and ev.event_type='sql_generated'),0),coalesce(p.sql_generated,0)) sql_generated,
      (select count(*) from public.usage_events ev where ev.user_id=u.id and ev.event_type='scenario_generated') generated_scenarios,
      (select count(*) from public.usage_events ev where ev.user_id=u.id and ev.event_type='dbfiddle_opened') fiddle_opened
    from auth.users u left join progress_by_user p on p.user_id=u.id
    where coalesce(u.raw_app_meta_data ->> 'app_role','') <> 'admin'
  )
  select jsonb_build_object(
    'total_users',(select count(*) from user_rows),
    'total_confirmed',(select coalesce(sum(scenarios_completed),0) from user_rows),
    'total_sql_generated',(select coalesce(sum(sql_generated),0) from user_rows),
    'total_generated_scenarios',(select count(*) from public.usage_events where event_type='scenario_generated'),
    'total_fiddle_opened',(select count(*) from public.usage_events where event_type='dbfiddle_opened'),
    'users',coalesce((select jsonb_agg(jsonb_build_object('email',u.email,'scenarios_started',u.scenarios_started,
      'scenarios_completed',u.scenarios_completed,'average_thinking_score',u.average_thinking_score,
      'sql_generated',u.sql_generated,'generated_scenarios',u.generated_scenarios,
      'dbfiddle_opened',u.fiddle_opened,'last_sign_in_at',u.last_sign_in_at)
      order by u.last_sign_in_at desc nulls last) from user_rows u),'[]'::jsonb),
    'recent_activity',coalesce((select jsonb_agg(jsonb_build_object('email',a.email,'event_type',a.event_type,'created_at',a.created_at)
      order by a.created_at desc) from (
        select u.email,e.event_type,e.created_at from public.usage_events e join auth.users u on u.id=e.user_id order by e.created_at desc limit 100
      ) a),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_dashboard_summary() from public;
grant execute on function public.admin_dashboard_summary() to authenticated;

-- After applying this migration, set the app administrator from the Supabase SQL editor:
-- update auth.users
-- set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"app_role":"admin"}'::jsonb
-- where email = 'YOUR_SIGN_IN_EMAIL';
-- Then sign out and sign in again so the refreshed JWT contains the trusted role claim.
