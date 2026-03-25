-- Run this in Supabase SQL Editor.
-- Creates a dedicated table for per-page student assessment results.

create extension if not exists pgcrypto;

create table if not exists public.student_assessment_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  course_title text,
  total_score integer not null default 0,
  total_questions integer not null default 0,
  completion_percent integer not null default 0,
  course_completed boolean not null default false,
  ai_feedback text,
  attempted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_assessment_results_unique_course unique (user_id, course_id)
);

create index if not exists idx_student_assessment_results_user_course
  on public.student_assessment_results (user_id, course_id);

create index if not exists idx_student_assessment_results_attempted_at
  on public.student_assessment_results (attempted_at desc);

create or replace function public.set_student_assessment_results_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_student_assessment_results_updated_at on public.student_assessment_results;
create trigger trg_student_assessment_results_updated_at
before update on public.student_assessment_results
for each row
execute function public.set_student_assessment_results_updated_at();

alter table public.student_assessment_results enable row level security;

-- Students can read/write only their own rows.
drop policy if exists student_assessment_results_select_own on public.student_assessment_results;
create policy student_assessment_results_select_own
on public.student_assessment_results
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists student_assessment_results_insert_own on public.student_assessment_results;
create policy student_assessment_results_insert_own
on public.student_assessment_results
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists student_assessment_results_update_own on public.student_assessment_results;
create policy student_assessment_results_update_own
on public.student_assessment_results
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Admins can read all rows for dashboard analytics.
drop policy if exists student_assessment_results_admin_select_all on public.student_assessment_results;
create policy student_assessment_results_admin_select_all
on public.student_assessment_results
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

-- Optional helper for client-side self-healing:
-- If the table was never created in a new environment, the app can call
-- `rpc('ensure_student_assessment_results_table')` and continue.
create or replace function public.ensure_student_assessment_results_table()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  was_created boolean := false;
begin
  if to_regclass('public.student_assessment_results') is null then
    was_created := true;

    create extension if not exists pgcrypto;

    create table if not exists public.student_assessment_results (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade,
      course_id uuid not null references public.courses(id) on delete cascade,
      course_title text,
      total_score integer not null default 0,
      total_questions integer not null default 0,
      completion_percent integer not null default 0,
      course_completed boolean not null default false,
      ai_feedback text,
      attempted_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint student_assessment_results_unique_course unique (user_id, course_id)
    );

    create index if not exists idx_student_assessment_results_user_course
      on public.student_assessment_results (user_id, course_id);

    create index if not exists idx_student_assessment_results_attempted_at
      on public.student_assessment_results (attempted_at desc);

    create or replace function public.set_student_assessment_results_updated_at()
    returns trigger
    language plpgsql
    as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$;

    drop trigger if exists trg_student_assessment_results_updated_at on public.student_assessment_results;
    create trigger trg_student_assessment_results_updated_at
    before update on public.student_assessment_results
    for each row
    execute function public.set_student_assessment_results_updated_at();

    alter table public.student_assessment_results enable row level security;

    drop policy if exists student_assessment_results_select_own on public.student_assessment_results;
    create policy student_assessment_results_select_own
    on public.student_assessment_results
    for select
    to authenticated
    using (auth.uid() = user_id);

    drop policy if exists student_assessment_results_insert_own on public.student_assessment_results;
    create policy student_assessment_results_insert_own
    on public.student_assessment_results
    for insert
    to authenticated
    with check (auth.uid() = user_id);

    drop policy if exists student_assessment_results_update_own on public.student_assessment_results;
    create policy student_assessment_results_update_own
    on public.student_assessment_results
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

    drop policy if exists student_assessment_results_admin_select_all on public.student_assessment_results;
    create policy student_assessment_results_admin_select_all
    on public.student_assessment_results
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
      )
    );
  end if;

  return jsonb_build_object('ok', true, 'created', was_created);
end;
$$;

revoke all on function public.ensure_student_assessment_results_table() from public;
grant execute on function public.ensure_student_assessment_results_table() to authenticated;
