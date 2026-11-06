-- =====================================================================
-- 05_roles_permissions.sql : rôles dynamiques et droits par application, cycle de vie des utilisateurs
-- À exécuter UNE FOIS dans Supabase > SQL Editor, après 01 à 04 (rejouable).
--   public.roles             : liste des rôles (admin, brasseur, user + rôles personnalisés)
--   public.role_permissions  : niveau d'accès par rôle et par application : none / read / write
--   app_level(app)           : niveau de l'utilisateur connecté (utilisé par le Calculateur)
-- Les fonctions has_app_access, can_write_budget, can_write_actuals, can_write_finance et can_edit
-- sont redéfinies pour lire ces tables. Les accès accordés individuellement (user_app_permissions)
-- restent valables en lecture.
-- =====================================================================
create table if not exists public.roles (
  id          text primary key check (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  name        text not null,
  description text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);
create table if not exists public.role_permissions (
  role_id text not null references public.roles(id) on delete cascade,
  app_key text not null check (app_key in ('calculateur','budget','analyse')),
  level   text not null default 'none' check (level in ('none','read','write')),
  primary key (role_id, app_key)
);

insert into public.roles (id, name, description, is_system) values
  ('admin',    'Administrateur', 'Accès total, gestion des utilisateurs et des rôles, validation du budget', true),
  ('brasseur', 'Brasseur',       'Peut modifier les applications autorisées', true),
  ('user',     'Utilisateur',    'Consultation seule des applications autorisées', true)
on conflict (id) do nothing;
insert into public.role_permissions (role_id, app_key, level)
select r, a, l from (values
  ('admin','calculateur','write'),('admin','budget','write'),('admin','analyse','write'),
  ('brasseur','calculateur','write'),('brasseur','budget','write'),('brasseur','analyse','write'),
  ('user','calculateur','read'),('user','budget','read'),('user','analyse','read')
) v(r, a, l)
on conflict (role_id, app_key) do nothing;

-- Niveau d'accès de l'utilisateur connecté à une application (clé : calculateur, budget ou analyse)
create or replace function public.app_level(p_app text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then 'write'
    else coalesce((select rp.level from public.profiles p join public.role_permissions rp on rp.role_id = p.role and rp.app_key = p_app where p.id = auth.uid()), 'none')
  end;
$$;
grant execute on function public.app_level(text) to authenticated;

create or replace function public.route_app(p_route text)
returns text language sql immutable as $$ select nullif(split_part(regexp_replace(coalesce(p_route,''), '^/apps/', ''), '/', 1), '') $$;

create or replace function public.has_app_access(p_route text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or public.app_level(public.route_app(p_route)) <> 'none'
      or exists (
        select 1 from public.user_app_permissions upa join public.applications a on a.id = upa.app_id
        where upa.user_id = auth.uid() and upa.has_access = true and a.route = p_route);
$$;
create or replace function public.can_edit()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.profiles p join public.role_permissions rp on rp.role_id = p.role where p.id = auth.uid() and rp.level = 'write');
$$;
create or replace function public.can_write_budget()
returns boolean language sql stable security definer set search_path = public as $$ select public.app_level('budget') = 'write' $$;
create or replace function public.can_write_actuals()
returns boolean language sql stable security definer set search_path = public as $$ select public.app_level('analyse') = 'write' $$;
create or replace function public.can_write_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select public.app_level('budget') = 'write' or public.app_level('analyse') = 'write' $$;

-- Calculateur : la modification dépend du niveau « calculateur » du rôle
do $$ begin
  if to_regclass('public.app_state') is not null then
    drop policy if exists app_state_insert on public.app_state;
    drop policy if exists app_state_update on public.app_state;
    create policy app_state_insert on public.app_state for insert to authenticated with check (public.app_level('calculateur') = 'write');
    create policy app_state_update on public.app_state for update to authenticated
      using (public.app_level('calculateur') = 'write') with check (public.app_level('calculateur') = 'write');
  end if;
end $$;

-- Sécurité : lecture pour tout compte connecté, écriture réservée aux administrateurs
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
revoke all on public.roles, public.role_permissions from anon;
grant select, insert, update, delete on public.roles, public.role_permissions to authenticated;
drop policy if exists roles_select on public.roles;
drop policy if exists roles_admin_write on public.roles;
drop policy if exists role_permissions_select on public.role_permissions;
drop policy if exists role_permissions_admin_write on public.role_permissions;
create policy roles_select on public.roles for select to authenticated using (true);
create policy roles_admin_write on public.roles for all to authenticated using (public.is_admin() and not is_system) with check (public.is_admin() and not is_system);
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);
create policy role_permissions_admin_write on public.role_permissions for all to authenticated
  using (public.is_admin() and role_id <> 'admin') with check (public.is_admin() and role_id <> 'admin');

-- Fiche profil créée à l'invitation (colonnes ajoutées si absentes)
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
