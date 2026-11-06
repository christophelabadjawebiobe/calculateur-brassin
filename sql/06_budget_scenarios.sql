-- 06_budget_scenarios.sql : budgets multi-scénarios (année + scénario), titre, verrouillage.
-- À exécuter après 02 et 04 (idempotent). La table des budgets s'appelle pcmn_budget_plans.
--   * scenario  : identifiant technique du scénario ('base' pour les budgets existants)
--   * title     : titre affiché (ex. « Atterrissage Réel », « Budget Prudent », « Objectif Seuil »)
--   * is_locked : budget « Validé & Verrouillé » (posé par un administrateur ; la saisie est alors refusée par la base)

alter table public.pcmn_budget_plans add column if not exists scenario  text    not null default 'base';
alter table public.pcmn_budget_plans add column if not exists title     text;
alter table public.pcmn_budget_plans add column if not exists is_locked boolean not null default false;

update public.pcmn_budget_plans set title = 'Budget ' || year where title is null;
-- les budgets déjà validés deviennent verrouillés
update public.pcmn_budget_plans set is_locked = true where validated_at is not null and not is_locked;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pcmn_plans_scenario_fmt' and conrelid = 'public.pcmn_budget_plans'::regclass) then
    alter table public.pcmn_budget_plans add constraint pcmn_plans_scenario_fmt check (scenario ~ '^[a-z0-9][a-z0-9_-]{0,40}$');
  end if;
end $$;

-- clé primaire (year) -> (year, scenario)
do $$
declare pk text; ncols int;
begin
  select conname, array_length(conkey, 1) into pk, ncols from pg_constraint
   where conrelid = 'public.pcmn_budget_plans'::regclass and contype = 'p';
  if pk is not null and ncols = 1 then
    execute format('alter table public.pcmn_budget_plans drop constraint %I', pk);
    alter table public.pcmn_budget_plans add primary key (year, scenario);
  end if;
end $$;

-- Garde-fou : seuls les administrateurs touchent à la validation et au verrou ; un budget verrouillé n'accepte plus de modification du contenu
create or replace function public.pcmn_plans_guard_validation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if (new.validated_data is not null or new.validated_at is not null or new.is_locked) and not public.is_admin() then
      new.validated_data := null; new.validated_at := null; new.validated_by := null; new.is_locked := false;
    end if;
  else
    if (new.validated_data is distinct from old.validated_data
        or new.validated_at is distinct from old.validated_at
        or new.validated_by is distinct from old.validated_by
        or new.is_locked    is distinct from old.is_locked) and not public.is_admin() then
      new.validated_data := old.validated_data; new.validated_at := old.validated_at; new.validated_by := old.validated_by; new.is_locked := old.is_locked;
    end if;
    if old.is_locked and new.is_locked and new.data is distinct from old.data then
      raise exception 'Budget verrouillé : retirez la validation pour le modifier' using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists trg_pcmn_plans_guard on public.pcmn_budget_plans;
create trigger trg_pcmn_plans_guard before insert or update on public.pcmn_budget_plans
  for each row execute function public.pcmn_plans_guard_validation();

-- Validation / déverrouillage d'un scénario (administrateur) : remplace la fonction à 2 arguments de sql/04
drop function if exists public.validate_pcmn_budget(integer, boolean);
create or replace function public.validate_pcmn_budget(p_year integer, p_validate boolean default true, p_scenario text default 'base')
returns timestamptz language plpgsql security definer set search_path = public as $$
declare ts timestamptz := now();
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
  if p_validate then
    update public.pcmn_budget_plans set validated_data = data, validated_at = ts, validated_by = auth.uid(), is_locked = true
     where year = p_year and scenario = p_scenario;
    if not found then raise exception 'Aucun budget enregistré pour % (%)', p_year, p_scenario; end if;
    return ts;
  end if;
  update public.pcmn_budget_plans set validated_data = null, validated_at = null, validated_by = null, is_locked = false
   where year = p_year and scenario = p_scenario;
  return null;
end; $$;
grant execute on function public.validate_pcmn_budget(integer, boolean, text) to authenticated;
