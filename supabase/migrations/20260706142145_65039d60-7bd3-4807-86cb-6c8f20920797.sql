
-- 1. Role enum
do $$ begin
  create type public.app_role as enum ('admin', 'employee');
exception when duplicate_object then null; end $$;

-- 2. Extend profiles
alter table public.profiles
  add column if not exists email text,
  add column if not exists status text not null default 'pending'
    check (status in ('pending','active','suspended'));

-- Backfill email from auth.users
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- 3. user_roles
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

-- 4. user_permissions
create table if not exists public.user_permissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  can_projects boolean not null default false,
  can_quotes boolean not null default false,
  can_safety boolean not null default false,
  can_assistant boolean not null default false,
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.user_permissions to authenticated;
grant all on public.user_permissions to service_role;
alter table public.user_permissions enable row level security;

-- 5. has_role security-definer
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- 6. Policies

-- profiles: admin-wide access (self policies already exist)
drop policy if exists "Admins read all profiles" on public.profiles;
create policy "Admins read all profiles"
  on public.profiles for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins update all profiles" on public.profiles;
create policy "Admins update all profiles"
  on public.profiles for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- user_roles policies
drop policy if exists "Users read own roles" on public.user_roles;
create policy "Users read own roles"
  on public.user_roles for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Admins read all roles" on public.user_roles;
create policy "Admins read all roles"
  on public.user_roles for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins insert roles" on public.user_roles;
create policy "Admins insert roles"
  on public.user_roles for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins delete roles" on public.user_roles;
create policy "Admins delete roles"
  on public.user_roles for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- user_permissions policies
drop policy if exists "Users read own permissions" on public.user_permissions;
create policy "Users read own permissions"
  on public.user_permissions for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Admins read all permissions" on public.user_permissions;
create policy "Admins read all permissions"
  on public.user_permissions for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins upsert permissions insert" on public.user_permissions;
create policy "Admins upsert permissions insert"
  on public.user_permissions for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins upsert permissions update" on public.user_permissions;
create policy "Admins upsert permissions update"
  on public.user_permissions for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- 7. Updated handle_new_user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    'pending'
  )
  on conflict (id) do nothing;

  insert into public.user_permissions (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
