-- Create student goals table and helper RPC for app-side auto-provisioning.

create table if not exists public.student_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id text not null,
  title text not null,
  course_id text not null,
  target_days integer not null check (target_days > 0),
  total_pages integer not null check (total_pages > 0),
  max_allowed_days integer not null check (max_allowed_days > 0),
  pages_per_day integer not null check (pages_per_day > 0),
  daily_plan jsonb not null default '[]'::jsonb,
  due_date timestamptz,
  goal_type text not null default 'course-deadline',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, goal_id)
);

create index if not exists idx_student_goals_user_id on public.student_goals(user_id);
create index if not exists idx_student_goals_course_id on public.student_goals(course_id);

alter table public.student_goals enable row level security;

-- Policies (idempotent via drop+create for portability)
drop policy if exists "Users can read own goals" on public.student_goals;
create policy "Users can read own goals"
  on public.student_goals
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own goals" on public.student_goals;
create policy "Users can insert own goals"
  on public.student_goals
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own goals" on public.student_goals;
create policy "Users can update own goals"
  on public.student_goals
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own goals" on public.student_goals;
create policy "Users can delete own goals"
  on public.student_goals
  for delete
  using (auth.uid() = user_id);

create or replace function public.ensure_student_goals_table()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  create table if not exists public.student_goals (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    goal_id text not null,
    title text not null,
    course_id text not null,
    target_days integer not null check (target_days > 0),
    total_pages integer not null check (total_pages > 0),
    max_allowed_days integer not null check (max_allowed_days > 0),
    pages_per_day integer not null check (pages_per_day > 0),
    daily_plan jsonb not null default '[]'::jsonb,
    due_date timestamptz,
    goal_type text not null default 'course-deadline',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, goal_id)
  );

  create index if not exists idx_student_goals_user_id on public.student_goals(user_id);
  create index if not exists idx_student_goals_course_id on public.student_goals(course_id);

  alter table public.student_goals enable row level security;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'student_goals' and policyname = 'Users can read own goals'
  ) then
    create policy "Users can read own goals"
      on public.student_goals
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'student_goals' and policyname = 'Users can insert own goals'
  ) then
    create policy "Users can insert own goals"
      on public.student_goals
      for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'student_goals' and policyname = 'Users can update own goals'
  ) then
    create policy "Users can update own goals"
      on public.student_goals
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'student_goals' and policyname = 'Users can delete own goals'
  ) then
    create policy "Users can delete own goals"
      on public.student_goals
      for delete
      using (auth.uid() = user_id);
  end if;
end;
$$;

grant execute on function public.ensure_student_goals_table() to authenticated;
