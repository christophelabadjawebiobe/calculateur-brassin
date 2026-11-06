-- 15_cooperateurs_edition_anonymisation.sql : Coopérateurs — édition manuelle sécurisée d'une fiche, avec audit dans public.journal
-- À exécuter après 07, 11, 13 et 14 (idempotent, rejouable).
--   1. journal_trace() : un « interrupteur » transactionnel (app.sans_trace_ligne) permet à une fonction de remplacer les traces ligne à ligne par UNE entrée de journal lisible.
--   2. modifier_cooperateur(id, données) : mise à jour sécurisée d'une fiche (identité, e-mail, téléphone, adresse, profil, bénéficiaire) ;
--      les parts, le capital, les mouvements et le n° de certificat ne sont JAMAIS modifiables ici. Une entrée d'audit (champs modifiés, ancienne / nouvelle valeur) est écrite dans public.journal.
--   3. NETTOYAGE : supprime les anciennes fonctions d'anonymisation destructive (anonymiser_donnees, apercu_anonymisation) si une version précédente de ce script les avait créées.
--      Plus aucune fonction de ce module n'écrase ou ne purge les données réelles. La confidentialité par rôle est traitée à part (sql/16 : lecture masquée, sans aucune écriture).
-- NB : le journal d'audit du module est la table public.journal (07).
-- ---------------------------------------------------------------------
-- 1. journal_trace : même fonction qu'en 07 + interrupteur app.sans_trace_ligne
-- ---------------------------------------------------------------------
create or replace function public.journal_trace() returns trigger
language plpgsql security definer set search_path = public as $$
declare rec jsonb; old_j jsonb; new_j jsonb; coop integer; lib text; ign text[] := array['updated_at'];
begin
  if coalesce(current_setting('app.sans_trace_ligne', true), '') = '1' then return coalesce(new, old); end if;   -- l'appelant écrit lui-même une entrée de journal détaillée
  if (select actif from public.journal_contexte where id = 1) is false then return coalesce(new, old); end if;
  old_j := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  new_j := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  if tg_op = 'UPDATE' and (old_j - ign) = (new_j - ign) then return new; end if;
  rec := coalesce(new_j, old_j);
  coop := case when tg_table_name = 'cooperateurs' then (rec->>'id')::integer
               when tg_table_name in ('categories','parametres','valorisations_annuelles') then null
               else nullif(rec->>'cooperateur_id', '')::integer end;
  lib := case when tg_table_name in ('cooperateurs','cooperateur_demandes') then nullif(trim(concat(rec->>'nom', ' ', rec->>'prenom')), '')
              when tg_table_name = 'parametres' then rec->>'cle'
              when tg_table_name = 'valorisations_annuelles' then rec->>'date_cloture'
              else tg_table_name end;
  insert into public.journal (utilisateur, action, operation, table_nom, enregistrement_id, cooperateur_id, libelle, avant, apres)
  values (public.journal_utilisateur(), nullif(current_setting('app.action', true), ''), tg_op, tg_table_name,
          case when tg_table_name = 'parametres' then rec->>'cle' else rec->>'id' end, coop, lib, old_j, new_j);
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- 2. Édition manuelle d'une fiche
--    p_data : objet JSON ; seules les clés présentes sont traitées (mise à jour partielle). Clés acceptées :
--      identité   : nom, prenom, representant, numero_identification, categorie_id, remarques
--      coordonnées: email, telephone (contact principal), rue, numero, code_postal, ville, pays (adresse principale)
--      profil     : profession, competences, accord_contact_tel (true / false / null)
--      bénéficiaire: est_cadeau, beneficiaire_nom, beneficiaire_prenom, beneficiaire_date_naissance, beneficiaire_lien, beneficiaire_email
--    Toute autre clé (parts, capital, certificat…) est refusée.
-- ---------------------------------------------------------------------
create or replace function public.modifier_cooperateur(p_id integer, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.cooperateurs%rowtype;
  champs_coop constant text[] := array['nom','prenom','representant','numero_identification','categorie_id','remarques','profession','competences','accord_contact_tel',
                                       'est_cadeau','beneficiaire_nom','beneficiaire_prenom','beneficiaire_date_naissance','beneficiaire_lien','beneficiaire_email'];
  champs_adr constant text[] := array['rue','numero','code_postal','ville','pays'];
  champs_ct  constant text[] := array['email','telephone'];
  k text; nv text; ov text; typ text; sets text[] := '{}';
  avant jsonb := '{}'::jsonb; apres jsonb := '{}'::jsonb; n_mod integer := 0; profil_change boolean := false;
  cid integer; a public.adresses%rowtype; patch_adr text[] := '{}'; adr_ok boolean := false;
begin
  perform public.coop_exiger_ecriture();
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Données de modification invalides'; end if;
  for k in select jsonb_object_keys(p_data) loop
    if not (k = any(champs_coop) or k = any(champs_adr) or k = any(champs_ct)) then
      raise exception 'Champ non modifiable ici : % (les parts, le capital et les mouvements se gèrent dans « Mouvements & Parts »)', k;
    end if;
  end loop;
  select * into c from public.cooperateurs where id = p_id for update;
  if not found then raise exception 'Coopérateur introuvable'; end if;
  perform set_config('app.sans_trace_ligne', '1', true);       -- une seule entrée d'audit, écrite plus bas
  perform set_config('app.action', 'Modification de la fiche', true);

  -- ---- table cooperateurs
  foreach k in array champs_coop loop
    continue when not (p_data ? k);
    nv := case when jsonb_typeof(p_data->k) = 'null' then null else nullif(trim(p_data->>k), '') end;
    ov := to_jsonb(c)->>k;
    typ := case when k = 'categorie_id' then 'integer' when k in ('accord_contact_tel','est_cadeau') then 'boolean' when k = 'beneficiaire_date_naissance' then 'date' else 'text' end;
    if k = 'numero_identification' and nv is not null then nv := nullif(regexp_replace(nv, '\D', '', 'g'), ''); end if;
    if k = 'nom' and nv is null then raise exception 'Le nom est obligatoire'; end if;
    if k = 'numero_identification' and nv is not null then
      if length(nv) not in (10, 11) and nv is distinct from ov then raise exception 'Numéro invalide : 11 chiffres (numéro national) ou 10 chiffres (numéro d''entreprise)'; end if;
      if exists (select 1 from public.cooperateurs x where x.numero_identification = nv and x.id <> p_id) then raise exception 'Ce numéro est déjà utilisé par un autre coopérateur' using errcode = '23505'; end if;
    end if;
    if k = 'categorie_id' and nv is not null and not exists (select 1 from public.categories where id = nv::integer) then raise exception 'Classe de parts inconnue'; end if;
    if k in ('accord_contact_tel','est_cadeau') and nv is not null and lower(nv) not in ('true','false') then raise exception 'Valeur Oui/Non invalide pour %', k; end if;
    if k = 'beneficiaire_date_naissance' and nv is not null and (nv::date > current_date or nv::date < date '1900-01-01') then raise exception 'Date de naissance invalide'; end if;
    if k = 'beneficiaire_email' and nv is not null and nv !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Adresse e-mail du bénéficiaire invalide'; end if;
    if nv is distinct from ov then
      avant := avant || jsonb_build_object(k, ov); apres := apres || jsonb_build_object(k, nv);
      sets := array_append(sets, format('%I = %L::%s', k, nv, typ)); n_mod := n_mod + 1;
      if k in ('profession','competences','accord_contact_tel') then profil_change := true; end if;
    end if;
  end loop;
  -- « Ce n'est plus un cadeau » : le bénéficiaire est effacé (cohérence)
  if p_data ? 'est_cadeau' and coalesce(nullif(trim(p_data->>'est_cadeau'), ''), 'false')::boolean is false and c.est_cadeau then
    foreach k in array array['beneficiaire_nom','beneficiaire_prenom','beneficiaire_date_naissance','beneficiaire_lien','beneficiaire_email'] loop
      continue when p_data ? k or to_jsonb(c)->>k is null;
      avant := avant || jsonb_build_object(k, to_jsonb(c)->>k); apres := apres || jsonb_build_object(k, null);
      sets := array_append(sets, format('%I = NULL', k)); n_mod := n_mod + 1;
    end loop;
  end if;
  if profil_change then sets := array_append(sets, 'profil_maj_le = now()'::text); end if;
  if cardinality(sets) > 0 then execute format('update public.cooperateurs set %s where id = %s', array_to_string(sets, ', '), p_id); end if;

  -- ---- contacts principaux (e-mail, téléphone)
  foreach k in array champs_ct loop
    continue when not (p_data ? k);
    nv := case when jsonb_typeof(p_data->k) = 'null' then null else nullif(trim(p_data->>k), '') end;
    if k = 'email' and nv is not null and nv !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Adresse e-mail invalide'; end if;
    select id, valeur into cid, ov from public.contacts where cooperateur_id = p_id and type = case when k = 'email' then 'email' else 'telephone' end order by principal desc, id limit 1;
    if nv is distinct from ov then
      avant := avant || jsonb_build_object(k, ov); apres := apres || jsonb_build_object(k, nv); n_mod := n_mod + 1;
      if nv is null then delete from public.contacts where id = cid;
      elsif cid is null then insert into public.contacts (cooperateur_id, type, valeur, principal) values (p_id, case when k = 'email' then 'email' else 'telephone' end, nv, true);
      else update public.contacts set valeur = nv where id = cid; end if;
    end if;
  end loop;

  -- ---- adresse principale
  foreach k in array champs_adr loop
    continue when not (p_data ? k);
    adr_ok := true;
  end loop;
  if adr_ok then
    select * into a from public.adresses where cooperateur_id = p_id order by (type = 'principale') desc, id limit 1;
    foreach k in array champs_adr loop
      continue when not (p_data ? k);
      nv := case when jsonb_typeof(p_data->k) = 'null' then null else nullif(trim(p_data->>k), '') end;
      ov := to_jsonb(a)->>k;
      if nv is distinct from ov then
        avant := avant || jsonb_build_object('adresse_' || k, ov); apres := apres || jsonb_build_object('adresse_' || k, nv); n_mod := n_mod + 1;
        patch_adr := patch_adr || format('%I = %L', k, nv);
      end if;
    end loop;
    if cardinality(patch_adr) > 0 then
      if a.id is null then
        insert into public.adresses (cooperateur_id, type) values (p_id, 'principale') returning id into cid;
      else cid := a.id; end if;
      execute format('update public.adresses set %s where id = %s', array_to_string(patch_adr, ', '), cid);
    end if;
  end if;

  perform set_config('app.sans_trace_ligne', '', true);
  if n_mod > 0 and coalesce((select actif from public.journal_contexte where id = 1), true) then
    insert into public.journal (utilisateur, action, operation, table_nom, enregistrement_id, cooperateur_id, libelle, avant, apres)
    values (public.journal_utilisateur(), 'Modification de la fiche', 'EVENEMENT', 'cooperateurs', p_id::text, p_id,
            (select nullif(trim(concat(nom, ' ', prenom)), '') from public.cooperateurs where id = p_id), avant, apres);
  end if;
  return jsonb_build_object('ok', true, 'modifications', n_mod, 'champs', (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_object_keys(apres) x));
end $$;
revoke all on function public.modifier_cooperateur(integer, jsonb) from public, anon;
grant execute on function public.modifier_cooperateur(integer, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Nettoyage : aucune fonction d'anonymisation destructive ne doit subsister en base
-- ---------------------------------------------------------------------
drop function if exists public.anonymiser_donnees(text, text, boolean);
drop function if exists public.apercu_anonymisation();

select 'modifier_cooperateur' as fonction, to_regprocedure('public.modifier_cooperateur(integer,jsonb)') is not null as ok
union all select 'anonymiser_donnees supprimée', to_regprocedure('public.anonymiser_donnees(text,text,boolean)') is null
union all select 'apercu_anonymisation supprimée', to_regprocedure('public.apercu_anonymisation()') is null;
