-- =====================================================================
-- 04_admin_reel_validation.sql
--   * administration des utilisateurs (droits de l'admin sur profiles / user_app_permissions)
--   * réalisé mensuel par compte PCMN (import Odoo) : table pcmn_actuals
--   * budget « validé » : instantané figé du budget, réservé aux administrateurs
--   * import d'une année depuis le module Budget (écriture de l'historique pour les éditeurs)
--   * noms des applications du tableau de bord
-- À exécuter UNE FOIS dans Supabase > SQL Editor, après 01, 02 et 03. Rejouable.
-- =====================================================================

-- 1. Droit d'écriture sur les données financières « importées » (Budget OU Analyse + rôle éditeur, ou admin)
create or replace function public.can_write_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.can_read_finance() and public.can_edit());
$$;
grant execute on function public.can_write_finance() to authenticated;

-- 2. Historique par compte : l'import d'une année depuis le Budget est ouvert aux éditeurs
drop policy if exists pcmn_history_write on public.pcmn_budget_history;
drop policy if exists pcmn_history_insert on public.pcmn_budget_history;
drop policy if exists pcmn_history_update on public.pcmn_budget_history;
drop policy if exists pcmn_history_delete on public.pcmn_budget_history;
create policy pcmn_history_insert on public.pcmn_budget_history for insert to authenticated with check (public.can_write_finance());
create policy pcmn_history_update on public.pcmn_budget_history for update to authenticated using (public.can_write_finance()) with check (public.can_write_finance());
create policy pcmn_history_delete on public.pcmn_budget_history for delete to authenticated using (public.can_write_finance());
grant select, insert, update, delete on public.pcmn_budget_history to authenticated;

-- 3. Réalisé mensuel par compte (montants au signe du budget : produits et charges positifs)
create table if not exists public.pcmn_actuals (
  account_key text     not null,
  year        integer  not null check (year between 2000 and 2100),
  month       smallint not null check (month between 1 and 12),
  amount      numeric(14,2) not null default 0,
  source      text     not null default 'import',
  imported_at timestamptz not null default now(),
  imported_by uuid     default auth.uid(),
  primary key (account_key, year, month)
);
create index if not exists pcmn_actuals_year_idx on public.pcmn_actuals (year, month);
alter table public.pcmn_actuals enable row level security;
revoke all on public.pcmn_actuals from anon;
grant select, insert, update, delete on public.pcmn_actuals to authenticated;
drop policy if exists pcmn_actuals_select on public.pcmn_actuals;
drop policy if exists pcmn_actuals_insert on public.pcmn_actuals;
drop policy if exists pcmn_actuals_update on public.pcmn_actuals;
drop policy if exists pcmn_actuals_delete on public.pcmn_actuals;
create policy pcmn_actuals_select on public.pcmn_actuals for select to authenticated using (public.can_read_finance());
create policy pcmn_actuals_insert on public.pcmn_actuals for insert to authenticated with check (public.can_write_finance());
create policy pcmn_actuals_update on public.pcmn_actuals for update to authenticated using (public.can_write_finance()) with check (public.can_write_finance());
create policy pcmn_actuals_delete on public.pcmn_actuals for delete to authenticated using (public.can_write_finance());

-- 4. Budget validé : instantané du document JSON, posé par un administrateur
alter table public.pcmn_budget_plans add column if not exists validated_data jsonb;
alter table public.pcmn_budget_plans add column if not exists validated_at   timestamptz;
alter table public.pcmn_budget_plans add column if not exists validated_by   uuid;

-- Seuls les administrateurs peuvent modifier ou effacer l'instantané (les éditeurs gardent la main sur le brouillon)
create or replace function public.pcmn_plans_guard_validation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if (new.validated_data is not null or new.validated_at is not null) and not public.is_admin() then
      new.validated_data := null; new.validated_at := null; new.validated_by := null;
    end if;
  elsif (new.validated_data is distinct from old.validated_data
      or new.validated_at   is distinct from old.validated_at
      or new.validated_by   is distinct from old.validated_by) and not public.is_admin() then
    new.validated_data := old.validated_data; new.validated_at := old.validated_at; new.validated_by := old.validated_by;
  end if;
  return new;
end; $$;
drop trigger if exists trg_pcmn_plans_guard on public.pcmn_budget_plans;
create trigger trg_pcmn_plans_guard before insert or update on public.pcmn_budget_plans
  for each row execute function public.pcmn_plans_guard_validation();

-- Fonction appelée par le bouton « Valider le budget » (admin uniquement)
create or replace function public.validate_pcmn_budget(p_year integer, p_validate boolean default true)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare ts timestamptz := now();
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
  if p_validate then
    update public.pcmn_budget_plans set validated_data = data, validated_at = ts, validated_by = auth.uid() where year = p_year;
    if not found then raise exception 'Aucun budget enregistré pour %', p_year; end if;
    return ts;
  end if;
  update public.pcmn_budget_plans set validated_data = null, validated_at = null, validated_by = null where year = p_year;
  return null;
end; $$;
grant execute on function public.validate_pcmn_budget(integer, boolean) to authenticated;

-- 5. Administration des utilisateurs : l'admin voit et gère tous les comptes (fonctions SECURITY DEFINER : pas de récursion RLS)
alter table public.profiles enable row level security;
alter table public.user_app_permissions enable row level security;
alter table public.applications enable row level security;

drop policy if exists profiles_admin_select on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
drop policy if exists profiles_self_select  on public.profiles;
create policy profiles_admin_select on public.profiles for select to authenticated using (public.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy profiles_self_select  on public.profiles for select to authenticated using (id = auth.uid());

drop policy if exists upa_admin_all  on public.user_app_permissions;
drop policy if exists upa_self_select on public.user_app_permissions;
create policy upa_admin_all   on public.user_app_permissions for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy upa_self_select on public.user_app_permissions for select to authenticated using (user_id = auth.uid());

drop policy if exists applications_select on public.applications;
create policy applications_select on public.applications for select to authenticated using (true);

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_app_permissions to authenticated;
grant select on public.applications to authenticated;

-- Garde-fou : on ne peut pas retirer le rôle admin au dernier administrateur
create or replace function public.profiles_keep_one_admin()
returns trigger language plpgsql as $$
begin
  if old.role = 'admin' and new.role is distinct from 'admin'
     and not exists (select 1 from public.profiles p where p.role = 'admin' and p.id <> old.id) then
    raise exception 'Impossible de retirer le dernier administrateur';
  end if;
  return new;
end; $$;
drop trigger if exists trg_profiles_keep_one_admin on public.profiles;
create trigger trg_profiles_keep_one_admin before update of role on public.profiles
  for each row execute function public.profiles_keep_one_admin();

-- 6. Applications du tableau de bord : noms (colonne name) et routes
update public.applications set name = 'Reporting' where route = '/apps/analyse';
update public.applications set name = 'Budget'    where route = '/apps/budget';
update public.applications set name = 'Recette'   where route = '/apps/calculateur';
-- L'application « Admin » (/admin/users) est ajoutée par le code du tableau de bord pour les administrateurs ;
-- si votre ancienne tuile « Users » existe, elle est renommée :
update public.applications set name = 'Admin', route = '/admin/users' where route in ('/dashboard/users', '/users', '/admin');
