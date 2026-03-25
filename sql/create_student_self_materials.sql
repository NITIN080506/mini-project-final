-- Create private self-study materials table for students.
-- Each row belongs to one authenticated user and is only readable/writable by that user.

create extension if not exists pgcrypto;

create table if not exists public.student_self_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_file_name text,
  source_file_type text,
  source_text text,
  material jsonb not null default '{"pages": []}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_student_self_materials_user_id on public.student_self_materials(user_id);
create index if not exists idx_student_self_materials_created_at on public.student_self_materials(created_at desc);

create or replace function public.set_student_self_materials_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_student_self_materials_updated_at on public.student_self_materials;
create trigger trg_student_self_materials_updated_at
before update on public.student_self_materials
for each row
execute function public.set_student_self_materials_updated_at();

alter table public.student_self_materials enable row level security;

drop policy if exists student_self_materials_select_own on public.student_self_materials;
create policy student_self_materials_select_own
on public.student_self_materials
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists student_self_materials_insert_own on public.student_self_materials;
create policy student_self_materials_insert_own
on public.student_self_materials
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists student_self_materials_update_own on public.student_self_materials;
create policy student_self_materials_update_own
on public.student_self_materials
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists student_self_materials_delete_own on public.student_self_materials;
create policy student_self_materials_delete_own
on public.student_self_materials
for delete
to authenticated
using (auth.uid() = user_id);

create or replace function public.ensure_student_self_materials_table()
returns jsonb
language plpgsql
security definer
set search_path = public
as $ensure$
declare
  was_created boolean := false;
begin
  if to_regclass('public.student_self_materials') is null then
    was_created := true;

    create extension if not exists pgcrypto;

    create table if not exists public.student_self_materials (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade,
      title text not null,
      source_file_name text,
      source_file_type text,
      source_text text,
      material jsonb not null default '{"pages": []}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists idx_student_self_materials_user_id on public.student_self_materials(user_id);
    create index if not exists idx_student_self_materials_created_at on public.student_self_materials(created_at desc);

    create or replace function public.set_student_self_materials_updated_at()
    returns trigger
    language plpgsql
    as $trigger$
    begin
      new.updated_at = now();
      return new;
    end;
    $trigger$;

    drop trigger if exists trg_student_self_materials_updated_at on public.student_self_materials;
    create trigger trg_student_self_materials_updated_at
    before update on public.student_self_materials
    for each row
    execute function public.set_student_self_materials_updated_at();

    alter table public.student_self_materials enable row level security;

    drop policy if exists student_self_materials_select_own on public.student_self_materials;
    create policy student_self_materials_select_own
    on public.student_self_materials
    for select
    to authenticated
    using (auth.uid() = user_id);

    drop policy if exists student_self_materials_insert_own on public.student_self_materials;
    create policy student_self_materials_insert_own
    on public.student_self_materials
    for insert
    to authenticated
    with check (auth.uid() = user_id);

    drop policy if exists student_self_materials_update_own on public.student_self_materials;
    create policy student_self_materials_update_own
    on public.student_self_materials
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

    drop policy if exists student_self_materials_delete_own on public.student_self_materials;
    create policy student_self_materials_delete_own
    on public.student_self_materials
    for delete
    to authenticated
    using (auth.uid() = user_id);
  end if;

  return jsonb_build_object('ok', true, 'created', was_created);
end;
$ensure$;

revoke all on function public.ensure_student_self_materials_table() from public;
grant execute on function public.ensure_student_self_materials_table() to authenticated;
