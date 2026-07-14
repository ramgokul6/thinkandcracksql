-- ============================================================
-- Crack SQL — Supabase setup
-- Run this once in: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- 1. Profiles table (one row per signed-up user)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  created_at timestamptz default now(),
  last_active timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-create a profile row whenever someone signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. Progress table (one row per completed scenario per user)
create table if not exists public.progress (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade not null,
  scenario_id text not null,
  completed_at timestamptz default now(),
  unique (user_id, scenario_id)
);

alter table public.progress enable row level security;

create policy "Users can view own progress"
  on public.progress for select
  using (auth.uid() = user_id);

create policy "Users can insert own progress"
  on public.progress for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own progress"
  on public.progress for delete
  using (auth.uid() = user_id);

-- ============================================================
-- Handy analytics queries to run anytime in the SQL Editor
-- ============================================================

-- Total signed-up users
-- select count(*) from public.profiles;

-- Active in the last 7 days
-- select count(*) from public.profiles where last_active > now() - interval '7 days';

-- Most-completed scenarios (what's popular)
-- select scenario_id, count(*) from public.progress group by scenario_id order by 2 desc limit 20;

-- Average scenarios completed per user
-- select avg(cnt) from (select user_id, count(*) cnt from public.progress group by user_id) t;
