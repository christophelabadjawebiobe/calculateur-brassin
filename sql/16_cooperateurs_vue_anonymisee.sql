-- 16_cooperateurs_vue_anonymisee.sql : Coopérateurs — niveau d'accès « Vue anonymisée » (lecture seule, données personnelles masquées PAR LA BASE)
-- À exécuter après 05, 07, 07b, 10, 11, 13, 14 (rejouable). AUCUNE écriture, AUCUNE modification ni suppression de données : le masquage est calculé à la lecture.
--   • role_permissions.level accepte 'anon' (uniquement pour l'application 'cooperateurs').
--   • Un rôle au niveau 'anon' ne peut PAS lire les tables brutes (RLS : can_read_cooperateurs() reste faux) : il ne reçoit que le résultat de coop_vue_anonymisee(),
--     où noms, e-mails, téléphones, numéros, rues, métiers, compétences, bénéficiaires et remarques sont déjà masqués. Impossible de contourner depuis le navigateur.
--   • Restent lisibles : montants, parts, dates de mouvements, n° de certificats, classes, communes, statistiques et valorisations.
--   • Rôle prêt à l'emploi : « coop_anonyme » (Vue coopérateurs anonymisée) ; affectation des utilisateurs dans Admin > Utilisateurs ou Coopérateurs > Paramètres.

-- 1. niveau 'anon' autorisé pour l'application 'cooperateurs' uniquement
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.role_permissions'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%level%'
  loop execute format('alter table public.role_permissions drop constraint %I', c); end loop;
  alter table public.role_permissions add constraint role_permissions_level_check
    check (level in ('none','read','write','anon') and (level <> 'anon' or app_key = 'cooperateurs'));
end $$;

-- 2. fonctions de masquage (pures, immuables)
create or replace function public.coop_masque_mot(w text) returns text language sql immutable as $$
  select case when w is null then null when char_length(w) <= 1 then w when char_length(w) = 2 then left(w, 1) || '*'
              else left(w, 1) || repeat('*', char_length(w) - 2) || right(w, 1) end $$;
create or replace function public.coop_masque_nom(s text) returns text language sql immutable as $$
  select case when s is null then null else coalesce((
    select string_agg(case when m[1] is not null then public.coop_masque_mot(m[1]) else m[2] end, '' order by ord)
      from regexp_matches(s, '([^ \-''’]+)|([ \-''’]+)', 'g') with ordinality as t(m, ord)), '') end $$;
create or replace function public.coop_masque_email(s text) returns text language sql immutable as $$
  select case when nullif(btrim(s), '') is null then null
              when position('@' in btrim(s)) < 2 then public.coop_masque_mot(btrim(s))
              else left(btrim(s), 1) || '****' || substring(btrim(s) from '@[^@]*$') end $$;
create or replace function public.coop_masque_tel(s text) returns text language sql immutable as $$
  select case when nullif(regexp_replace(coalesce(s, ''), '\D', '', 'g'), '') is null then null else
    left(case when regexp_replace(s, '\D', '', 'g') like '0032%' then '0' || substr(regexp_replace(s, '\D', '', 'g'), 5)
              when regexp_replace(s, '\D', '', 'g') like '32%' and char_length(regexp_replace(s, '\D', '', 'g')) >= 10 then '0' || substr(regexp_replace(s, '\D', '', 'g'), 3)
              else regexp_replace(s, '\D', '', 'g') end, 2) || 'XX/******' end $$;
create or replace function public.coop_masque_numero(s text) returns text language sql immutable as $$
  select case when nullif(regexp_replace(coalesce(s, ''), '\D', '', 'g'), '') is null then null
              when char_length(regexp_replace(s, '\D', '', 'g')) = 10 then 'XXXX.XXX.XXX' else 'XX.XX.XX-XXX.XX' end $$;

-- 3. le profil courant est-il « vue anonymisée » ? (un administrateur ne l'est jamais)
create or replace function public.coop_est_anonyme() returns boolean language sql stable security definer set search_path = public as $$
  select not public.is_admin() and public.app_level('cooperateurs') = 'anon' $$;
revoke all on function public.coop_est_anonyme() from public, anon;
grant execute on function public.coop_est_anonyme() to authenticated;

-- 4. lecture directe des données NON personnelles autorisée pour le profil anonyme (classes, paramètres, valorisations)
do $$
declare t text;
begin
  foreach t in array array['categories','parametres','valorisations_annuelles'] loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.can_read_cooperateurs() or public.coop_est_anonyme())', t);
  end loop;
end $$;

-- 5. données masquées : mêmes structures que les tables (cooperateurs + categories / adresses / contacts / mouvements_parts imbriqués ; cooperateur_demandes)
create or replace function public.coop_vue_anonymisee() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare coops jsonb; dem jsonb;
begin
  if not public.coop_est_anonyme() then raise exception 'Réservé au profil « vue coopérateurs anonymisée »' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(
      (to_jsonb(c) - 'google_row_id') || jsonb_build_object(
        'nom', public.coop_masque_nom(c.nom), 'prenom', public.coop_masque_nom(c.prenom), 'representant', public.coop_masque_nom(c.representant),
        'numero_identification', public.coop_masque_numero(c.numero_identification),
        'remarques', case when nullif(btrim(c.remarques), '') is null then null else '••••••' end,
        'profession', case when nullif(btrim(to_jsonb(c)->>'profession'), '') is null then null else '••••••' end,
        'competences', case when nullif(btrim(to_jsonb(c)->>'competences'), '') is null then null else '••••••' end,
        'beneficiaire_nom', public.coop_masque_nom(to_jsonb(c)->>'beneficiaire_nom'), 'beneficiaire_prenom', public.coop_masque_nom(to_jsonb(c)->>'beneficiaire_prenom'),
        'beneficiaire_email', public.coop_masque_email(to_jsonb(c)->>'beneficiaire_email'),
        'beneficiaire_date_naissance', case when to_jsonb(c)->>'beneficiaire_date_naissance' is null then null else left(to_jsonb(c)->>'beneficiaire_date_naissance', 4) || '-01-01' end,
        'categories', (select jsonb_build_object('code', k.code, 'libelle', k.libelle) from public.categories k where k.id = c.categorie_id),
        'adresses', coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('rue', case when nullif(btrim(a.rue), '') is null then null else '•••••' end, 'numero', null)) from public.adresses a where a.cooperateur_id = c.id), '[]'::jsonb),
        'contacts', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('valeur', case when t.type = 'email' then public.coop_masque_email(t.valeur) else public.coop_masque_tel(t.valeur) end)) from public.contacts t where t.cooperateur_id = c.id), '[]'::jsonb),
        'mouvements_parts', coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from public.mouvements_parts m where m.cooperateur_id = c.id), '[]'::jsonb)
      ) order by c.id), '[]'::jsonb) into coops
    from public.cooperateurs c;
  select coalesce(jsonb_agg(
      to_jsonb(d) || jsonb_build_object(
        'nom', public.coop_masque_nom(d.nom), 'prenom', public.coop_masque_nom(d.prenom), 'representant', public.coop_masque_nom(d.representant),
        'email', public.coop_masque_email(d.email), 'telephone', public.coop_masque_tel(d.telephone),
        'rue', case when nullif(btrim(d.rue), '') is null then null else '•••••' end, 'numero', null,
        'numero_national', public.coop_masque_numero(d.numero_national),
        'profession', case when nullif(btrim(to_jsonb(d)->>'profession'), '') is null then null else '••••••' end,
        'competences', case when nullif(btrim(to_jsonb(d)->>'competences'), '') is null then null else '••••••' end,
        'beneficiaire_nom', public.coop_masque_nom(to_jsonb(d)->>'beneficiaire_nom'), 'beneficiaire_prenom', public.coop_masque_nom(to_jsonb(d)->>'beneficiaire_prenom'),
        'beneficiaire_email', public.coop_masque_email(to_jsonb(d)->>'beneficiaire_email'),
        'beneficiaire_date_naissance', case when to_jsonb(d)->>'beneficiaire_date_naissance' is null then null else left(to_jsonb(d)->>'beneficiaire_date_naissance', 4) || '-01-01' end,
        -- la référence de virement contient le nom du souscripteur (« LDF2026 : NOM Prénom ») : la partie nominative est masquée
        'reference_bancaire', case when d.reference_bancaire is null then null when position(' : ' in d.reference_bancaire) > 0
            then split_part(d.reference_bancaire, ' : ', 1) || ' : ' || public.coop_masque_nom(substr(d.reference_bancaire, position(' : ' in d.reference_bancaire) + 3)) else d.reference_bancaire end,
        'google_row_id', null, 'donnees_brutes', null, 'odoo_sign_request_id', null
      ) order by d.date_demande desc), '[]'::jsonb) into dem
    from public.cooperateur_demandes d;
  return jsonb_build_object('coops', coops, 'demandes', dem);
end $$;
revoke all on function public.coop_vue_anonymisee() from public, anon;
grant execute on function public.coop_vue_anonymisee() to authenticated;

-- 6. rôle prêt à l'emploi (non système : l'administrateur peut le modifier) ; ne touche aucun autre rôle
insert into public.roles (id, name, description, is_system)
values ('coop_anonyme', 'Vue coopérateurs anonymisée', 'Consultation des chiffres, statistiques et mouvements des Coopérateurs ; données personnelles toujours masquées, lecture seule', false)
on conflict (id) do nothing;
insert into public.role_permissions (role_id, app_key, level)
select 'coop_anonyme', a, case when a = 'cooperateurs' then 'anon' else 'none' end from unnest(array['calculateur','budget','analyse','cooperateurs']) a
on conflict (role_id, app_key) do nothing;

-- Contrôle
select 'rôle' as controle, r.id, rp.app_key, rp.level from public.roles r join public.role_permissions rp on rp.role_id = r.id where r.id = 'coop_anonyme' order by rp.app_key;
