-- =====================================================================
-- 07b_cooperateurs_acces.sql : s'assure que l'application « Coopérateurs » est bien déclarée et reliée aux permissions
-- Rejouable à volonté, indépendant de 07 (utile si la grille Admin > Rôles n'affiche pas « Coopérateurs » ou si la tuile manque).
--   1. role_permissions accepte la clé 'cooperateurs'
--   2. chaque rôle a une ligne 'cooperateurs' (admin = write, les autres = none : à ouvrir dans Admin > Rôles)
--   3. fonctions d'accès can_read_cooperateurs / can_write_cooperateurs
--   4. ligne '/apps/cooperateurs' dans la table applications (tuile du tableau de bord), quel que soit le type de applications.id
-- =====================================================================

-- 1. clé d'application autorisée
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.role_permissions'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%app_key%'
  loop execute format('alter table public.role_permissions drop constraint %I', c); end loop;
  alter table public.role_permissions add constraint role_permissions_app_key_check
    check (app_key in ('calculateur','budget','analyse','cooperateurs'));
end $$;

-- 2. une ligne par rôle (les niveaux déjà réglés ne sont jamais écrasés)
insert into public.role_permissions (role_id, app_key, level)
select r.id, 'cooperateurs', case when r.id = 'admin' then 'write' else 'none' end from public.roles r
on conflict (role_id, app_key) do nothing;
update public.role_permissions set level = 'write' where role_id = 'admin' and app_key = 'cooperateurs' and level <> 'write';

-- 3. fonctions d'accès
create or replace function public.can_write_cooperateurs()
returns boolean language sql stable security definer set search_path = public as $$ select public.app_level('cooperateurs') = 'write' $$;
create or replace function public.can_read_cooperateurs()
returns boolean language sql stable security definer set search_path = public as $$ select public.app_level('cooperateurs') in ('read','write') $$;
grant execute on function public.can_write_cooperateurs() to authenticated;
grant execute on function public.can_read_cooperateurs() to authenticated;

-- 4. tuile « Coopérateurs » (id généré selon son type s'il n'a pas de valeur par défaut)
do $$
declare typ text; has_def boolean; has_icon boolean;
begin
  select data_type, column_default is not null into typ, has_def
    from information_schema.columns where table_schema = 'public' and table_name = 'applications' and column_name = 'id';
  if not exists (select 1 from public.applications where route = '/apps/cooperateurs') then
    if has_def then
      insert into public.applications (name, description, route) values ('Coopérateurs', 'Registre, souscriptions, certificats et assemblée générale', '/apps/cooperateurs');
    elsif typ = 'uuid' then
      insert into public.applications (id, name, description, route) values (gen_random_uuid(), 'Coopérateurs', 'Registre, souscriptions, certificats et assemblée générale', '/apps/cooperateurs');
    elsif typ in ('integer','bigint','smallint') then
      execute 'insert into public.applications (id, name, description, route) select coalesce(max(id), 0) + 1, $1, $2, $3 from public.applications'
        using 'Coopérateurs', 'Registre, souscriptions, certificats et assemblée générale', '/apps/cooperateurs';
    else
      insert into public.applications (id, name, description, route) values (gen_random_uuid()::text, 'Coopérateurs', 'Registre, souscriptions, certificats et assemblée générale', '/apps/cooperateurs');
    end if;
  end if;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'applications' and column_name = 'icon') into has_icon;
  if has_icon then update public.applications set icon = coalesce(icon, 'Users') where route = '/apps/cooperateurs'; end if;
end $$;

-- Contrôle : une ligne par rôle + la tuile
select 'role_permissions' as controle, role_id, app_key, level from public.role_permissions where app_key = 'cooperateurs' order by role_id;
select 'applications' as controle, id::text as id, name, route from public.applications where route = '/apps/cooperateurs';
