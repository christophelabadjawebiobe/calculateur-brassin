-- =====================================================================
-- 03_app_state_calculateur.sql : base partagée du Calculateur de brassin
-- À exécuter UNE FOIS dans Supabase > SQL Editor, après 01_budget_analyse.sql (rejouable).
-- Rôles lus dans la table profiles (comme le reste du projet) : is_admin(), can_edit(), has_app_access().
--   admin    : tout
--   brasseur : lit et écrit, mais ne supprime pas de recette et ne touche pas à l'analyse annuelle
--   user     : lecture seule
-- Remplace les policies basées sur le JWT de l'ancienne version HTML (supabase-roles.sql).
-- =====================================================================
create table if not exists public.app_state (
  id         text primary key,
  data       jsonb not null,
  state_json text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.app_state enable row level security;

do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='app_state' loop
    execute format('drop policy %I on public.app_state', p.policyname);
  end loop;
end $$;

create policy app_state_select on public.app_state for select to authenticated
  using (public.has_app_access('/apps/calculateur'));
create policy app_state_insert on public.app_state for insert to authenticated
  with check (public.has_app_access('/apps/calculateur') and public.can_edit());
create policy app_state_update on public.app_state for update to authenticated
  using (public.has_app_access('/apps/calculateur') and public.can_edit())
  with check (public.has_app_access('/apps/calculateur') and public.can_edit());
create policy app_state_delete on public.app_state for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.app_state to authenticated;

-- Garde-fous sur le contenu JSON (une policy ne voit pas l'intérieur du document)
create or replace function public.app_state_guard()
returns trigger language plpgsql as $$
begin
  if not public.is_admin() then
    if jsonb_array_length(coalesce(new.data->'recipes','[]'::jsonb)) < jsonb_array_length(coalesce(old.data->'recipes','[]'::jsonb)) then
      raise exception 'Suppression de recette réservée aux administrateurs' using errcode='42501';
    end if;
    if (new.data->'annual') is distinct from (old.data->'annual') then
      raise exception 'Analyse annuelle réservée aux administrateurs' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists app_state_guard on public.app_state;
create trigger app_state_guard before update on public.app_state for each row execute function public.app_state_guard();
