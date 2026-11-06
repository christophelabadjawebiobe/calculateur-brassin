-- 11_cooperateurs_audit_mouvements.sql : Coopérateurs — mouvements de parts signés + journal d'audit enrichi
-- À exécuter après 07 (idempotent, rejouable).
--   1. Signe des mouvements : le signe de nombre_parts est la seule vérité ; montant_total prend toujours le même signe
--      (un montant saisi avec le mauvais signe est corrigé par la base, jamais écrasé en valeur absolue).
--   2. RPC enregistrer_mouvement(...) : saisie manuelle atomique (+ souscription / − retrait), contrôle du solde, trace au journal.
--   3. Journal d'audit : la table public.journal (07) est réutilisée. On ajoute
--        - l'événement « Détection des doublons » (même sans nouveau groupe),
--        - la vue v_journal_evenements : type d'événement + détail lisible + nom du coopérateur,
--        - la vue v_journal_utilisateurs (liste des auteurs pour le filtre).

-- ---------------------------------------------------------------------
-- 1. Cohérence du signe entre nombre_parts et montant_total
-- ---------------------------------------------------------------------
create or replace function public.mouvements_montant() returns trigger
language plpgsql as $$
begin
  if new.montant_total is null then
    new.montant_total := new.nombre_parts * public.coop_valeur_part();
  elsif new.montant_total <> 0 and sign(new.montant_total) <> sign(new.nombre_parts) then
    new.montant_total := sign(new.nombre_parts) * abs(new.montant_total);
  end if;
  return new;
end $$;
drop trigger if exists trg_mvt_montant on public.mouvements_parts;
create trigger trg_mvt_montant before insert or update on public.mouvements_parts for each row execute function public.mouvements_montant();

-- ---------------------------------------------------------------------
-- 2. Saisie manuelle d'un mouvement (positif = souscription, négatif = retrait / remboursement)
-- ---------------------------------------------------------------------
create or replace function public.enregistrer_mouvement(p_coop integer, p_date date, p_parts integer, p_montant numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare detenues integer; vp numeric := public.coop_valeur_part(); mt numeric; nid integer;
begin
  perform public.coop_exiger_ecriture();
  if p_parts is null or p_parts = 0 then raise exception 'Le nombre de parts doit être différent de zéro (positif : souscription, négatif : retrait)'; end if;
  if not exists (select 1 from public.cooperateurs where id = p_coop) then raise exception 'Coopérateur introuvable'; end if;
  select coalesce(sum(nombre_parts), 0) into detenues from public.mouvements_parts where cooperateur_id = p_coop;
  if p_parts < 0 and detenues + p_parts < 0 then
    raise exception 'Retrait de % part(s) impossible : le coopérateur n''en détient que %', abs(p_parts), detenues;
  end if;
  mt := case when p_montant is null or p_montant = 0 then p_parts * vp else sign(p_parts) * abs(p_montant) end;
  perform set_config('app.action', case when p_parts > 0 then 'Mouvement de parts : souscription manuelle (+' || p_parts || ')' else 'Mouvement de parts : retrait / remboursement (' || p_parts || ')' end, true);
  insert into public.mouvements_parts (cooperateur_id, date_mouvement, nombre_parts, montant_total) values (p_coop, p_date, p_parts, mt) returning id into nid;
  return jsonb_build_object('id', nid, 'parts', p_parts, 'montant', mt, 'solde', detenues + p_parts);
end $$;
grant execute on function public.enregistrer_mouvement(integer, date, integer, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 3a. Journal : l'exécution de « Détection des doublons » est toujours consignée (patch de la fonction de 07)
-- ---------------------------------------------------------------------
do $$
declare d text; marque text := '-- journal_detection'; ancre text := E'  return jsonb_build_object(''groupes'', n_total';
begin
  select pg_get_functiondef('public.detecter_doublons()'::regprocedure) into d;
  if position(marque in d) > 0 then raise notice 'detecter_doublons : déjà journalisée'; return; end if;
  if position(ancre in d) = 0 then raise notice 'detecter_doublons : ancre introuvable, fonction inchangée'; return; end if;
  d := replace(d, ancre, E'  insert into public.journal (utilisateur, action, operation, table_nom, libelle, apres)  ' || marque || E'\n'
    || E'  values (public.journal_utilisateur(), ''Détection des doublons'', ''EVENEMENT'', ''groupes_doublons'', n_total || '' groupe(s) dont '' || n_new || '' nouveau(x)'', jsonb_build_object(''groupes'', n_total, ''nouveaux'', n_new));\n' || ancre);
  execute d;
end $$;

-- ---------------------------------------------------------------------
-- 3b. Vue d'affichage du journal
-- ---------------------------------------------------------------------
create or replace view public.v_journal_evenements with (security_invoker = true) as
select j.id, j.horodatage, j.utilisateur, j.action, j.operation, j.table_nom, j.enregistrement_id, j.cooperateur_id, j.libelle, j.avant, j.apres,
  case
    when j.action ilike 'Fusion%' then 'fusion'
    when j.action ilike 'Détection%' or j.action ilike 'Doublons%' or j.table_nom in ('groupes_doublons', 'groupes_doublons_membres') then 'doublons'
    when j.action ilike 'Import%' then 'import'
    when j.action ilike 'Validation%' or j.action ilike 'Déverrouillage%' or j.action ilike 'Reverrouillage%' or j.table_nom = 'cooperateur_demandes' then 'souscription'
    when j.table_nom = 'mouvements_parts' then 'mouvement'
    when j.table_nom in ('adresses', 'contacts', 'cooperateurs') then 'coordonnees'
    else 'autre'
  end as type_evenement,
  coalesce(nullif(trim(concat(c.nom, ' ', c.prenom)), ''), nullif(j.apres->>'nom', ''), nullif(j.avant->>'nom', '')) as cooperateur_nom
from public.journal j
left join public.cooperateurs c on c.id = j.cooperateur_id;

create or replace view public.v_journal_utilisateurs with (security_invoker = true) as
select distinct utilisateur from public.journal where utilisateur is not null;

revoke all on public.v_journal_evenements, public.v_journal_utilisateurs from anon;
grant select on public.v_journal_evenements, public.v_journal_utilisateurs to authenticated;
create index if not exists ix_journal_utilisateur on public.journal (utilisateur);

-- ---------------------------------------------------------------------
-- 4. Icône de la tuile « Coopérateurs » (le tableau de bord choisit l'icône « user-check » d'après la route ; la colonne est mise à jour pour cohérence)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'applications' and column_name = 'icon') then
    update public.applications set icon = 'UserCheck' where route = '/apps/cooperateurs';
  end if;
end $$;
