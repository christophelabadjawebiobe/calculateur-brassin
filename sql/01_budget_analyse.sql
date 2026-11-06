-- =====================================================================
-- Brasserie Coopérative La Badjawe : modules BUDGET et ANALYSE
-- À exécuter dans Supabase > SQL Editor (une seule fois, script rejouable).
-- Prérequis : tables profiles, applications, user_app_permissions existantes.
-- Hypothèses (à adapter si besoin, voir section 1) :
--   * applications.route vaut '/apps/budget' et '/apps/analyse'
--   * profiles.role vaut 'admin' pour les administrateurs ;
--     'admin' et 'brasseur' peuvent écrire, les autres rôles sont en lecture seule
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Fonctions d'autorisation (SECURITY DEFINER : évitent la récursion RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

-- Qui peut modifier les données (en plus d'avoir accès à l'application) ?
create or replace function public.can_edit()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','brasseur'));
$$;

-- L'utilisateur connecté a-t-il accès à l'application dont la route est p_route ?
create or replace function public.has_app_access(p_route text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1
    from public.user_app_permissions upa
    join public.applications a on a.id = upa.app_id
    where upa.user_id = auth.uid() and upa.has_access = true and a.route = p_route
  );
$$;

-- Lecture des données financières : Budget OU Analyse (l'analyse a besoin du budget)
create or replace function public.can_read_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_app_access('/apps/budget') or public.has_app_access('/apps/analyse');
$$;

create or replace function public.can_write_budget()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.has_app_access('/apps/budget') and public.can_edit());
$$;

create or replace function public.can_write_actuals()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.has_app_access('/apps/analyse') and public.can_edit());
$$;

grant execute on function public.is_admin(), public.can_edit(), public.has_app_access(text),
  public.can_read_finance(), public.can_write_budget(), public.can_write_actuals() to authenticated;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ---------------------------------------------------------------------
-- 2. Référentiel des catégories (commun au budget et au réel)
--    kind = 'revenu' (plus c'est haut, mieux c'est) ou 'cout' (plus c'est bas, mieux c'est)
-- ---------------------------------------------------------------------
create table if not exists public.finance_categories (
  code       text primary key,
  label      text not null,
  kind       text not null check (kind in ('revenu','cout')),
  sort_order int  not null default 0
);

insert into public.finance_categories (code, label, kind, sort_order) values
  ('ventes',             'Ventes (chiffre d''affaires)',  'revenu', 10),
  ('autres_revenus',     'Autres revenus et subsides',    'revenu', 20),
  ('matieres_premieres', 'Matières premières',            'cout',   30),
  ('charges_variables',  'Charges variables',             'cout',   40),
  ('personnel',          'Personnel',                     'cout',   50),
  ('charges_fixes',      'Charges fixes',                 'cout',   60)
on conflict (code) do update set label = excluded.label, kind = excluded.kind, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- 3. BUDGET prévisionnel
-- ---------------------------------------------------------------------
-- Un budget par année (et par scénario). Un seul budget "actif" par année : c'est lui que l'analyse compare au réel.
create table if not exists public.budget_plans (
  id          uuid primary key default gen_random_uuid(),
  year        int  not null check (year between 2000 and 2100),
  name        text not null default 'Budget',
  is_active   boolean not null default true,
  notes       text,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (year, name)
);
create unique index if not exists budget_plans_one_active_per_year on public.budget_plans (year) where is_active;

-- Une ligne = un mois, une catégorie, un libellé (ex. 'Ventes HORECA'). Montants en € HTVA, toujours positifs.
create table if not exists public.budget_lines (
  id        uuid primary key default gen_random_uuid(),
  plan_id   uuid not null references public.budget_plans(id) on delete cascade,
  month     smallint not null check (month between 1 and 12),
  category  text not null references public.finance_categories(code),
  label     text not null default '' ,
  amount    numeric(14,2) not null default 0 check (amount >= 0),
  updated_at timestamptz not null default now(),
  unique (plan_id, month, category, label)
);
create index if not exists budget_lines_plan_idx on public.budget_lines (plan_id, category);

-- Volumes prévus (hL brassés / vendus) par mois
create table if not exists public.budget_volumes (
  plan_id     uuid not null references public.budget_plans(id) on delete cascade,
  month       smallint not null check (month between 1 and 12),
  hl_brewed   numeric(12,2) not null default 0 check (hl_brewed >= 0),
  hl_sold     numeric(12,2) not null default 0 check (hl_sold >= 0),
  updated_at  timestamptz not null default now(),
  primary key (plan_id, month)
);

-- ---------------------------------------------------------------------
-- 4. ANALYSE : chiffres réels mensuels
-- ---------------------------------------------------------------------
create table if not exists public.actuals_monthly (
  id        uuid primary key default gen_random_uuid(),
  year      int  not null check (year between 2000 and 2100),
  month     smallint not null check (month between 1 and 12),
  category  text not null references public.finance_categories(code),
  label     text not null default '',
  amount    numeric(14,2) not null default 0 check (amount >= 0),
  source    text not null default 'manuel',      -- 'manuel', 'import', 'compta'…
  created_by uuid references auth.users(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (year, month, category, label)
);
create index if not exists actuals_monthly_ym_idx on public.actuals_monthly (year, month);

create table if not exists public.actual_volumes (
  year       int not null check (year between 2000 and 2100),
  month      smallint not null check (month between 1 and 12),
  hl_brewed  numeric(12,2) not null default 0 check (hl_brewed >= 0),
  hl_sold    numeric(12,2) not null default 0 check (hl_sold >= 0),
  updated_at timestamptz not null default now(),
  primary key (year, month)
);

-- updated_at automatique
do $$
declare t text;
begin
  foreach t in array array['budget_plans','budget_lines','budget_volumes','actuals_monthly','actual_volumes'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$s', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$s for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Vues d'analyse (security_invoker : les politiques RLS de l'utilisateur s'appliquent)
-- ---------------------------------------------------------------------
-- Réel agrégé par mois et catégorie
create or replace view public.v_actuals_agg with (security_invoker = true) as
  select year, month, category, sum(amount) as amount
  from public.actuals_monthly group by year, month, category;

-- Budget actif agrégé par mois et catégorie
create or replace view public.v_budget_agg with (security_invoker = true) as
  select p.year, l.month, l.category, sum(l.amount) as amount
  from public.budget_lines l join public.budget_plans p on p.id = l.plan_id
  where p.is_active group by p.year, l.month, l.category;

-- Réel vs budget, avec l'écart "favorable" (positif = bon pour la brasserie) et la comparaison N-1
create or replace view public.v_budget_vs_actual with (security_invoker = true) as
with keys as (
  select year, month, category from public.v_budget_agg
  union select year, month, category from public.v_actuals_agg
  union select year + 1, month, category from public.v_actuals_agg      -- permet d'afficher N-1 même sans réel N
)
select k.year, k.month, k.category, c.label as category_label, c.kind, c.sort_order,
       coalesce(b.amount, 0)  as budget,
       coalesce(a.amount, 0)  as actual,
       coalesce(pa.amount, 0) as prev_actual,
       coalesce(a.amount, 0) - coalesce(b.amount, 0) as variance,
       case when c.kind = 'revenu' then coalesce(a.amount,0) - coalesce(b.amount,0)
            else coalesce(b.amount,0) - coalesce(a.amount,0) end as variance_favorable,
       case when coalesce(b.amount,0) <> 0 then (coalesce(a.amount,0) - b.amount) / b.amount * 100 end as variance_pct,
       coalesce(a.amount, 0) - coalesce(pa.amount, 0) as yoy_variance,
       case when coalesce(pa.amount,0) <> 0 then (coalesce(a.amount,0) - pa.amount) / pa.amount * 100 end as yoy_pct
from keys k
join public.finance_categories c on c.code = k.category
left join public.v_budget_agg  b  on (b.year, b.month, b.category)  = (k.year, k.month, k.category)
left join public.v_actuals_agg a  on (a.year, a.month, a.category)  = (k.year, k.month, k.category)
left join public.v_actuals_agg pa on (pa.year, pa.month, pa.category) = (k.year - 1, k.month, k.category);

-- Volumes : budget, réel et N-1
create or replace view public.v_volumes_compare with (security_invoker = true) as
with spine as (
  select year, month from public.actual_volumes
  union select p.year, v.month from public.budget_volumes v join public.budget_plans p on p.id = v.plan_id where p.is_active
  union select year + 1, month from public.actual_volumes
)
select s.year, s.month,
       coalesce(bv.hl_brewed, 0) as budget_brewed, coalesce(bv.hl_sold, 0) as budget_sold,
       coalesce(av.hl_brewed, 0) as actual_brewed, coalesce(av.hl_sold, 0) as actual_sold,
       coalesce(pv.hl_brewed, 0) as prev_brewed,   coalesce(pv.hl_sold, 0) as prev_sold
from spine s
left join (select p.year, v.month, v.hl_brewed, v.hl_sold
           from public.budget_volumes v join public.budget_plans p on p.id = v.plan_id where p.is_active) bv
       on (bv.year, bv.month) = (s.year, s.month)
left join public.actual_volumes av on (av.year, av.month) = (s.year, s.month)
left join public.actual_volumes pv on (pv.year, pv.month) = (s.year - 1, s.month);

grant select on public.v_actuals_agg, public.v_budget_agg, public.v_budget_vs_actual, public.v_volumes_compare to authenticated;

-- ---------------------------------------------------------------------
-- 6. SÉCURITÉ : Row Level Security
-- ---------------------------------------------------------------------
alter table public.finance_categories enable row level security;
alter table public.budget_plans       enable row level security;
alter table public.budget_lines       enable row level security;
alter table public.budget_volumes     enable row level security;
alter table public.actuals_monthly    enable row level security;
alter table public.actual_volumes     enable row level security;

-- Aucun accès pour le rôle anonyme
revoke all on public.finance_categories, public.budget_plans, public.budget_lines, public.budget_volumes,
              public.actuals_monthly, public.actual_volumes from anon;
grant select, insert, update, delete on public.budget_plans, public.budget_lines, public.budget_volumes,
              public.actuals_monthly, public.actual_volumes to authenticated;
grant select on public.finance_categories to authenticated;

-- Référentiel : lecture pour tout utilisateur connecté ayant accès à Budget ou Analyse
drop policy if exists finance_categories_select on public.finance_categories;
create policy finance_categories_select on public.finance_categories for select to authenticated using (public.can_read_finance());

-- Budget : lecture (Budget ou Analyse), écriture (Budget + rôle éditeur, ou admin)
do $$
declare t text;
begin
  foreach t in array array['budget_plans','budget_lines','budget_volumes'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.can_read_finance())', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.can_write_budget())', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.can_write_budget()) with check (public.can_write_budget())', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.can_write_budget())', t);
  end loop;
  -- Réel : lecture (Budget ou Analyse), écriture (Analyse + rôle éditeur, ou admin)
  foreach t in array array['actuals_monthly','actual_volumes'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.can_read_finance())', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.can_write_actuals())', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.can_write_actuals()) with check (public.can_write_actuals())', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.can_write_actuals())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. (Optionnel) Donner l'accès à un utilisateur : remplacez l'e-mail
-- ---------------------------------------------------------------------
-- insert into public.user_app_permissions (user_id, app_id, has_access)
-- select p.id, a.id, true
-- from public.profiles p cross join public.applications a
-- where p.email = 'christophe@coconut-event.be' and a.route in ('/apps/budget','/apps/analyse')
-- on conflict (user_id, app_id) do update set has_access = true;   -- suppose une clé unique (user_id, app_id)
