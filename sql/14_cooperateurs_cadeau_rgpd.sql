-- 14_cooperateurs_cadeau_rgpd.sql : Coopérateurs — parts offertes (cadeau / mineur) et consentement à la newsletter
-- À exécuter après 07, 11 et 13 (idempotent, rejouable).
-- NB : la table des demandes de souscription s'appelle public.cooperateur_demandes (et non « demandes_souscription »).
--   1. Colonnes sur cooperateur_demandes (réponses du formulaire) et sur cooperateurs (fiche du registre) :
--        est_cadeau, beneficiaire_nom / _prenom / _date_naissance / _lien / _email, consentement_newsletter
--      + newsletter_repondu (demandes) : distingue « Non » explicite (retrait du consentement) de « question absente du formulaire ».
--   2. importer_demandes() : enregistre ces champs (mêmes règles que 07 / 13).
--   3. valider_demande()   : recopie fidèlement ces champs de la demande vers la fiche du coopérateur.
--   4. Vue v_newsletter_abonnes : seuls les coopérateurs ayant dit « Oui » (liste d'envoi Odoo / Brevo).
-- Convention : le souscripteur (celui qui paie) est le coopérateur de la fiche ; le bénéficiaire (enfant / proche) est décrit sur la fiche.

-- ---------------------------------------------------------------------
-- 1. Colonnes
-- ---------------------------------------------------------------------
alter table public.cooperateur_demandes add column if not exists est_cadeau                  boolean not null default false;
alter table public.cooperateur_demandes add column if not exists beneficiaire_nom            text;
alter table public.cooperateur_demandes add column if not exists beneficiaire_prenom         text;
alter table public.cooperateur_demandes add column if not exists beneficiaire_date_naissance date;
alter table public.cooperateur_demandes add column if not exists beneficiaire_lien           text;
alter table public.cooperateur_demandes add column if not exists beneficiaire_email          text;
alter table public.cooperateur_demandes add column if not exists consentement_newsletter     boolean not null default false;
alter table public.cooperateur_demandes add column if not exists newsletter_repondu          boolean not null default false;

alter table public.cooperateurs add column if not exists est_cadeau                  boolean not null default false;
alter table public.cooperateurs add column if not exists beneficiaire_nom            text;
alter table public.cooperateurs add column if not exists beneficiaire_prenom         text;
alter table public.cooperateurs add column if not exists beneficiaire_date_naissance date;
alter table public.cooperateurs add column if not exists beneficiaire_lien           text;
alter table public.cooperateurs add column if not exists beneficiaire_email          text;
alter table public.cooperateurs add column if not exists consentement_newsletter     boolean not null default false;

create index if not exists ix_coop_newsletter on public.cooperateurs (id) where consentement_newsletter;
create index if not exists ix_coop_cadeau on public.cooperateurs (id) where est_cadeau;

-- ---------------------------------------------------------------------
-- 2. Import des demandes (remplace la fonction de 13 : mêmes règles + cadeau / bénéficiaire / newsletter)
-- ---------------------------------------------------------------------
create or replace function public.importer_demandes(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; nb_new integer := 0; nb_skip integer := 0; ex integer; id_new uuid;
        v_prof text; v_comp text; v_acc boolean;
        v_cad boolean; v_bnom text; v_bpre text; v_bnai date; v_blien text; v_bmail text; v_nl boolean; v_nlrep boolean;
begin
  perform public.coop_exiger_ecriture();
  perform set_config('app.action', 'Import Google Sheet', true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_prof := nullif(trim(r->>'profession'), '');
    v_comp := nullif(trim(r->>'competences'), '');
    v_acc  := nullif(r->>'accord_contact_tel', '')::boolean;
    v_cad  := coalesce(nullif(r->>'est_cadeau', '')::boolean, false);
    v_bnom := case when v_cad then nullif(trim(r->>'beneficiaire_nom'), '') end;
    v_bpre := case when v_cad then nullif(trim(r->>'beneficiaire_prenom'), '') end;
    v_bnai := case when v_cad then nullif(r->>'beneficiaire_date_naissance', '')::date end;
    v_blien := case when v_cad then nullif(trim(r->>'beneficiaire_lien'), '') end;
    v_bmail := case when v_cad then nullif(trim(r->>'beneficiaire_email'), '') end;
    v_nl   := coalesce(nullif(r->>'consentement_newsletter', '')::boolean, false);
    v_nlrep := coalesce(nullif(r->>'newsletter_repondu', '')::boolean, false);
    if nullif(r->>'google_row_id', '') is null then nb_skip := nb_skip + 1; continue; end if;
    if exists (select 1 from public.cooperateur_demandes where google_row_id = r->>'google_row_id') then
      -- ligne déjà importée : jamais écrasée, mais les champs encore vides (et la ligne non verrouillée) sont complétés
      update public.cooperateur_demandes set
             profession = coalesce(profession, v_prof), competences = coalesce(competences, v_comp), accord_contact_tel = coalesce(accord_contact_tel, v_acc),
             est_cadeau = est_cadeau or v_cad,
             beneficiaire_nom = coalesce(beneficiaire_nom, v_bnom), beneficiaire_prenom = coalesce(beneficiaire_prenom, v_bpre),
             beneficiaire_date_naissance = coalesce(beneficiaire_date_naissance, v_bnai), beneficiaire_lien = coalesce(beneficiaire_lien, v_blien),
             beneficiaire_email = coalesce(beneficiaire_email, v_bmail),
             consentement_newsletter = case when newsletter_repondu then consentement_newsletter else v_nl end,
             newsletter_repondu = newsletter_repondu or v_nlrep
       where google_row_id = r->>'google_row_id' and not is_locked
         and ((profession is null and v_prof is not null) or (competences is null and v_comp is not null) or (accord_contact_tel is null and v_acc is not null)
           or (not est_cadeau and v_cad) or (not newsletter_repondu and v_nlrep));
      nb_skip := nb_skip + 1; continue;
    end if;
    ex := public.coop_trouver_existant(r->>'numero_national', r->>'email');
    insert into public.cooperateur_demandes (google_row_id, date_demande, nom, prenom, representant, email, telephone, rue, numero, code_postal, ville, pays,
        numero_national, numero_valide, reference_bancaire, type_souscripteur, categorie_code, nombre_parts, is_existing_coop, existing_coop_id, donnees_brutes,
        profession, competences, accord_contact_tel,
        est_cadeau, beneficiaire_nom, beneficiaire_prenom, beneficiaire_date_naissance, beneficiaire_lien, beneficiaire_email, consentement_newsletter, newsletter_repondu)
    values (r->>'google_row_id', coalesce(nullif(r->>'date_demande', '')::timestamptz, now()), coalesce(nullif(trim(r->>'nom'), ''), '(sans nom)'), nullif(trim(r->>'prenom'), ''),
        nullif(trim(r->>'representant'), ''), nullif(trim(r->>'email'), ''), nullif(trim(r->>'telephone'), ''), r->>'rue', r->>'numero', r->>'code_postal', r->>'ville', coalesce(nullif(r->>'pays', ''), 'Belgique'),
        r->>'numero_national', nullif(r->>'numero_valide', '')::boolean, r->>'reference_bancaire', coalesce(nullif(r->>'type_souscripteur', ''), 'personne_physique'),
        coalesce(nullif(r->>'categorie_code', ''), 'B'), greatest(1, coalesce(nullif(r->>'nombre_parts', '')::integer, 1)), ex is not null, ex, r->'donnees_brutes',
        v_prof, v_comp, v_acc,
        v_cad, v_bnom, v_bpre, v_bnai, v_blien, v_bmail, v_nl, v_nlrep)
    returning id into id_new;
    nb_new := nb_new + 1;
  end loop;
  return jsonb_build_object('importees', nb_new, 'ignorees', nb_skip);
end $$;
grant execute on function public.importer_demandes(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Validation dans le registre : fonction de 07 + recopie du cadeau / bénéficiaire / consentement newsletter sur la fiche
--    - cadeau : est_cadeau reste vrai dès qu'une souscription a été faite pour un bénéficiaire ; la dernière souscription cadeau fournit les champs bénéficiaire
--      (l'historique complet reste sur les demandes, onglet « Souscriptions & Demandes »)
--    - newsletter : la réponse la plus récente fait foi (un « Non » retire le consentement) ; sans réponse, la fiche est inchangée
-- ---------------------------------------------------------------------
create or replace function public.valider_demande(p_demande uuid, p_date date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.cooperateur_demandes%rowtype; cid integer; cert integer; nouveau boolean; cat integer; dt date; vp numeric := public.coop_valeur_part();
begin
  perform public.coop_exiger_ecriture();
  select * into d from public.cooperateur_demandes where id = p_demande for update;
  if not found then raise exception 'Demande introuvable'; end if;
  if d.is_locked or d.valide_registre then raise exception 'Cette demande est déjà validée dans le registre'; end if;
  if not d.paiement_confirme then raise exception 'Confirmez d''abord le paiement'; end if;
  perform set_config('app.action', 'Validation dans le registre', true);
  perform pg_advisory_xact_lock(70071);                       -- numérotation des certificats sans doublon
  dt := coalesce(p_date, d.date_paiement::date, current_date);
  cid := public.coop_trouver_existant(d.numero_national, d.email);
  select id into cat from public.categories where code = d.categorie_code;
  if cid is null then
    nouveau := true;
    insert into public.cooperateurs (certificat, nom, prenom, representant, numero_identification, categorie_id)
    values ((select coalesce(max(certificat), 0) + 1 from public.cooperateurs), d.nom, d.prenom, d.representant, d.numero_national, cat)
    returning id, certificat into cid, cert;
  else
    nouveau := false;
    select certificat into cert from public.cooperateurs where id = cid;
    if cert is null and (select code from public.categories ca join public.cooperateurs c on c.categorie_id = ca.id where c.id = cid) is distinct from 'A' then
      cert := (select coalesce(max(certificat), 0) + 1 from public.cooperateurs);
      update public.cooperateurs set certificat = cert where id = cid;
    end if;
    update public.cooperateurs set numero_identification = coalesce(numero_identification, d.numero_national) where id = cid;
  end if;
  if (nullif(d.rue, '') is not null or nullif(d.ville, '') is not null) and not exists (select 1 from public.adresses where cooperateur_id = cid) then
    insert into public.adresses (cooperateur_id, type, rue, numero, code_postal, ville, pays) values (cid, 'principale', d.rue, d.numero, d.code_postal, d.ville, d.pays);
  end if;
  if nullif(trim(coalesce(d.email, '')), '') is not null and not exists (select 1 from public.contacts where cooperateur_id = cid and type = 'email' and lower(valeur) = lower(trim(d.email))) then
    insert into public.contacts (cooperateur_id, type, valeur, principal)
    values (cid, 'email', trim(d.email), not exists (select 1 from public.contacts where cooperateur_id = cid and type = 'email' and principal));
  end if;
  if nullif(trim(coalesce(d.telephone, '')), '') is not null and not exists (select 1 from public.contacts where cooperateur_id = cid and type = 'telephone' and valeur = trim(d.telephone)) then
    insert into public.contacts (cooperateur_id, type, valeur, principal)
    values (cid, 'telephone', trim(d.telephone), not exists (select 1 from public.contacts where cooperateur_id = cid and type = 'telephone' and principal));
  end if;
  insert into public.mouvements_parts (cooperateur_id, date_mouvement, nombre_parts, montant_total, demande_id) values (cid, dt, d.nombre_parts, d.nombre_parts * vp, d.id);
  -- cadeau / bénéficiaire / consentement newsletter -> fiche
  update public.cooperateurs c set
    est_cadeau                  = c.est_cadeau or d.est_cadeau,
    beneficiaire_nom            = case when d.est_cadeau then d.beneficiaire_nom else c.beneficiaire_nom end,
    beneficiaire_prenom         = case when d.est_cadeau then d.beneficiaire_prenom else c.beneficiaire_prenom end,
    beneficiaire_date_naissance = case when d.est_cadeau then d.beneficiaire_date_naissance else c.beneficiaire_date_naissance end,
    beneficiaire_lien           = case when d.est_cadeau then d.beneficiaire_lien else c.beneficiaire_lien end,
    beneficiaire_email          = case when d.est_cadeau then d.beneficiaire_email else c.beneficiaire_email end,
    consentement_newsletter     = case when d.newsletter_repondu then d.consentement_newsletter else c.consentement_newsletter end
  where c.id = cid;
  update public.cooperateur_demandes set cooperateur_id = cid, certificat_numero = cert, valide_registre = true, is_locked = true,
         is_existing_coop = not nouveau, existing_coop_id = case when nouveau then null else cid end where id = d.id;
  return jsonb_build_object('cooperateur_id', cid, 'certificat', cert, 'nouveau', nouveau, 'date', dt);
end $$;
grant execute on function public.valider_demande(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Abonnés à la newsletter : uniquement ceux qui ont consenti (« Oui » explicite) et qui ont une adresse e-mail
-- ---------------------------------------------------------------------
create or replace view public.v_newsletter_abonnes with (security_invoker = true) as
select c.id as cooperateur_id, c.certificat, c.nom, c.prenom,
  (select ct.valeur from public.contacts ct where ct.cooperateur_id = c.id and ct.type = 'email' order by ct.principal desc, ct.id limit 1) as email
from public.cooperateurs c
where c.consentement_newsletter
  and exists (select 1 from public.contacts ct where ct.cooperateur_id = c.id and ct.type = 'email');
revoke all on public.v_newsletter_abonnes from anon;
grant select on public.v_newsletter_abonnes to authenticated;

-- contrôle
select 'demandes cadeau' as controle, count(*) from public.cooperateur_demandes where est_cadeau
union all select 'fiches avec parts offertes', count(*) from public.cooperateurs where est_cadeau
union all select 'abonnés newsletter', count(*) from public.v_newsletter_abonnes;
