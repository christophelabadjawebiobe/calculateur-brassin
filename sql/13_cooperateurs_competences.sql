-- 13_cooperateurs_competences.sql : Coopérateurs — métier, compétences/talents et accord de contact téléphonique (Google Form)
-- À exécuter après 07 et 11 (idempotent, rejouable).
--   1. Colonnes profession / competences / accord_contact_tel sur cooperateur_demandes (réponse du formulaire)
--      et sur cooperateurs (profil du sociétaire) + profil_source ('google_form') et profil_maj_le.
--   2. importer_demandes() : enregistre les 3 nouvelles réponses (et complète les lignes déjà importées et non verrouillées si leurs champs sont vides).
--   3. Trigger demande_vers_profil() : à la « Validation dans le registre », le profil est recopié sur la fiche du coopérateur.
--      La réponse la plus récente fait foi : un « Non » retire la personne de l'annuaire.
--   4. Reprise de l'existant : si les réponses figurent déjà dans donnees_brutes (ligne brute du Sheet), le profil des coopérateurs déjà validés est renseigné.
--   5. Vue v_annuaire_competences : l'annuaire, filtré strictement (formulaire + accord « Oui » + détenteur de parts).

-- ---------------------------------------------------------------------
-- 1. Colonnes
-- ---------------------------------------------------------------------
alter table public.cooperateur_demandes add column if not exists profession         text;
alter table public.cooperateur_demandes add column if not exists competences        text;
alter table public.cooperateur_demandes add column if not exists accord_contact_tel boolean;   -- null = non renseigné (traité comme « Non »)

alter table public.cooperateurs add column if not exists profession         text;
alter table public.cooperateurs add column if not exists competences        text;
alter table public.cooperateurs add column if not exists accord_contact_tel boolean;
alter table public.cooperateurs add column if not exists profil_source      text;              -- 'google_form' : le profil provient d'un formulaire complété
alter table public.cooperateurs add column if not exists profil_maj_le      timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cooperateurs_profil_source_chk' and conrelid = 'public.cooperateurs'::regclass) then
    alter table public.cooperateurs add constraint cooperateurs_profil_source_chk check (profil_source is null or profil_source in ('google_form'));
  end if;
end $$;
create index if not exists ix_coop_annuaire on public.cooperateurs (id) where accord_contact_tel is true and profil_source = 'google_form';

-- ---------------------------------------------------------------------
-- 2. Import des demandes (remplace la fonction de 07 : mêmes règles + 3 champs)
-- ---------------------------------------------------------------------
create or replace function public.importer_demandes(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; nb_new integer := 0; nb_skip integer := 0; ex integer; id_new uuid;
        v_prof text; v_comp text; v_acc boolean;
begin
  perform public.coop_exiger_ecriture();
  perform set_config('app.action', 'Import Google Sheet', true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_prof := nullif(trim(r->>'profession'), '');
    v_comp := nullif(trim(r->>'competences'), '');
    v_acc  := nullif(r->>'accord_contact_tel', '')::boolean;
    if nullif(r->>'google_row_id', '') is null then nb_skip := nb_skip + 1; continue; end if;
    if exists (select 1 from public.cooperateur_demandes where google_row_id = r->>'google_row_id') then
      -- ligne déjà importée : jamais écrasée, mais les champs de profil encore vides (et la ligne non verrouillée) sont complétés
      update public.cooperateur_demandes set profession = coalesce(profession, v_prof), competences = coalesce(competences, v_comp), accord_contact_tel = coalesce(accord_contact_tel, v_acc)
       where google_row_id = r->>'google_row_id' and not is_locked
         and ((profession is null and v_prof is not null) or (competences is null and v_comp is not null) or (accord_contact_tel is null and v_acc is not null));
      nb_skip := nb_skip + 1; continue;
    end if;
    ex := public.coop_trouver_existant(r->>'numero_national', r->>'email');
    insert into public.cooperateur_demandes (google_row_id, date_demande, nom, prenom, representant, email, telephone, rue, numero, code_postal, ville, pays,
        numero_national, numero_valide, reference_bancaire, type_souscripteur, categorie_code, nombre_parts, is_existing_coop, existing_coop_id, donnees_brutes,
        profession, competences, accord_contact_tel)
    values (r->>'google_row_id', coalesce(nullif(r->>'date_demande', '')::timestamptz, now()), coalesce(nullif(trim(r->>'nom'), ''), '(sans nom)'), nullif(trim(r->>'prenom'), ''),
        nullif(trim(r->>'representant'), ''), nullif(trim(r->>'email'), ''), nullif(trim(r->>'telephone'), ''), r->>'rue', r->>'numero', r->>'code_postal', r->>'ville', coalesce(nullif(r->>'pays', ''), 'Belgique'),
        r->>'numero_national', nullif(r->>'numero_valide', '')::boolean, r->>'reference_bancaire', coalesce(nullif(r->>'type_souscripteur', ''), 'personne_physique'),
        coalesce(nullif(r->>'categorie_code', ''), 'B'), greatest(1, coalesce(nullif(r->>'nombre_parts', '')::integer, 1)), ex is not null, ex, r->'donnees_brutes',
        v_prof, v_comp, v_acc)
    returning id into id_new;
    nb_new := nb_new + 1;
  end loop;
  return jsonb_build_object('importees', nb_new, 'ignorees', nb_skip);
end $$;
grant execute on function public.importer_demandes(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Validation dans le registre : recopie du profil sur la fiche du coopérateur
-- ---------------------------------------------------------------------
create or replace function public.demande_vers_profil() returns trigger
language plpgsql security definer set search_path = public as $$
declare a_info boolean := nullif(trim(coalesce(new.profession, '')), '') is not null or nullif(trim(coalesce(new.competences, '')), '') is not null;
begin
  if new.cooperateur_id is null or not (a_info or new.accord_contact_tel is not null) then return new; end if;
  update public.cooperateurs c set
    profession         = coalesce(nullif(trim(coalesce(new.profession, '')), ''), c.profession),
    competences        = coalesce(nullif(trim(coalesce(new.competences, '')), ''), c.competences),
    accord_contact_tel = coalesce(new.accord_contact_tel, c.accord_contact_tel),      -- la réponse la plus récente fait foi (un « Non » retire de l'annuaire)
    profil_source      = case when a_info or c.profil_source is not null then 'google_form' else c.profil_source end,
    profil_maj_le      = now()
  where c.id = new.cooperateur_id;
  return new;
end $$;
drop trigger if exists trg_demande_vers_profil on public.cooperateur_demandes;
create trigger trg_demande_vers_profil after update of valide_registre on public.cooperateur_demandes
  for each row when (new.valide_registre and not old.valide_registre) execute function public.demande_vers_profil();

-- ---------------------------------------------------------------------
-- 4. Reprise de l'existant depuis donnees_brutes (en-têtes d'origine du Sheet) : uniquement les fiches sans profil
-- ---------------------------------------------------------------------
create or replace function public.coop_brut(p_brut jsonb, p_re text, p_re2 text default null) returns text
language sql immutable as $$
  select nullif(trim(v.value), '') from jsonb_each_text(case when jsonb_typeof(p_brut) = 'object' then p_brut else '{}'::jsonb end) v
   where lower(v.key) ~ p_re and (p_re2 is null or lower(v.key) ~ p_re2) and nullif(trim(v.value), '') is not null limit 1
$$;
create or replace function public.coop_ouinon(p text) returns boolean
language sql immutable as $$
  select case when lower(trim(coalesce(p, ''))) ~ '^(oui|yes|ja|o|true|1)\M' then true
              when lower(trim(coalesce(p, ''))) ~ '^(non|no|nee|n|false|0)\M' then false end
$$;

update public.cooperateurs c set
  profession = x.prof, competences = x.comp, accord_contact_tel = x.acc, profil_source = 'google_form', profil_maj_le = now()
from (
  select distinct on (d.cooperateur_id) d.cooperateur_id,
         public.coop_brut(d.donnees_brutes, 'm.tier|profession') as prof,
         public.coop_brut(d.donnees_brutes, 'comp.tence|talent|savoir') as comp,
         public.coop_ouinon(public.coop_brut(d.donnees_brutes, '(accept|accord|autoris|consent|tre contact|contacter)', 't.l.phone|\mtel\M|appel|gsm|mobile')) as acc
    from public.cooperateur_demandes d
   where d.valide_registre and d.cooperateur_id is not null and d.donnees_brutes is not null
   order by d.cooperateur_id, d.date_demande desc
) x
where c.id = x.cooperateur_id and c.profil_source is null and (x.prof is not null or x.comp is not null);

-- ---------------------------------------------------------------------
-- 5. Annuaire des compétences : filtre strict, appliqué aussi côté base
--    (profil issu d'un formulaire complété + accord de contact téléphonique « Oui » + au moins un métier/une compétence + parts détenues)
-- ---------------------------------------------------------------------
create or replace view public.v_annuaire_competences with (security_invoker = true) as
select c.id as cooperateur_id, c.certificat, c.nom, c.prenom, c.profession, c.competences,
  (select ct.valeur from public.contacts ct where ct.cooperateur_id = c.id and ct.type = 'telephone' order by ct.principal desc, ct.id limit 1) as telephone,
  (select ct.valeur from public.contacts ct where ct.cooperateur_id = c.id and ct.type = 'email' order by ct.principal desc, ct.id limit 1) as email,
  coalesce((select sum(m.nombre_parts) from public.mouvements_parts m where m.cooperateur_id = c.id), 0)::integer as parts
from public.cooperateurs c
where c.profil_source = 'google_form'
  and c.accord_contact_tel is true
  and (nullif(trim(coalesce(c.profession, '')), '') is not null or nullif(trim(coalesce(c.competences, '')), '') is not null)
  and coalesce((select sum(m.nombre_parts) from public.mouvements_parts m where m.cooperateur_id = c.id), 0) > 0;
revoke all on public.v_annuaire_competences from anon;
grant select on public.v_annuaire_competences to authenticated;

-- contrôle
select 'fiches avec profil' as controle, count(*) from public.cooperateurs where profil_source = 'google_form'
union all select 'dans l''annuaire', count(*) from public.v_annuaire_competences;
