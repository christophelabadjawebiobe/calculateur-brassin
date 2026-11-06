\set ON_ERROR_STOP on
\i sql/mock_nodef.sql
\i sql/01_budget_analyse.sql
\i sql/02_budget_pcmn.sql
\i sql/03_app_state_calculateur.sql
\i sql/04_admin_reel_validation.sql
\i sql/05_roles_permissions.sql
\i sql/06_budget_scenarios.sql
\i sql/07_cooperateurs.sql
\i sql/10_acces_roles.sql
\i sql/11_cooperateurs_audit_mouvements.sql
\i sql/13_cooperateurs_competences.sql
\i sql/14_cooperateurs_cadeau_rgpd.sql
\i sql/15_cooperateurs_edition_anonymisation.sql
\i sql/15_cooperateurs_edition_anonymisation.sql
\i sql/16_cooperateurs_vue_anonymisee.sql
\i sql/16_cooperateurs_vue_anonymisee.sql
\set ON_ERROR_STOP off
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a'; set request.jwt.claims='{"email":"a@x"}';
select 'import', importer_demandes('[
 {"google_row_id":"A","nom":"Martin","prenom":"Alice","email":"alice@x.be","telephone":"0471 11 22 33","rue":"Rue du Test","numero":"12","code_postal":"4000","ville":"Liège","numero_national":"85073003328","nombre_parts":2,"reference_bancaire":"LDF2026 : MARTIN Alice","profession":"Comptable","competences":"compta","accord_contact_tel":true,"donnees_brutes":{"Nom":"Martin"}},
 {"google_row_id":"B","nom":"BRASSERIE DU COIN SRL","representant":"Marc Leroy","email":"marc@coin.be","telephone":"04 222","ville":"Ans","code_postal":"4430","numero_national":"0123456749","type_souscripteur":"entreprise","categorie_code":"D","nombre_parts":10,"est_cadeau":true,"beneficiaire_nom":"Leroy","beneficiaire_prenom":"Zoé","beneficiaire_date_naissance":"2015-06-01","beneficiaire_lien":"Parent","beneficiaire_email":"zoe@x.be"},
 {"google_row_id":"C","nom":"Carl","prenom":"Carl","email":"carl@x.be","nombre_parts":1}
]'::jsonb);
update cooperateur_demandes set paiement_confirme=true;
select 'valider', google_row_id, valider_demande(id)->>'certificat' from cooperateur_demandes order by 2;
\set ON_ERROR_STOP off

\echo === EDITION (admin)
select 'edit', modifier_cooperateur(1, '{"prenom":"Alicia","telephone":"0499 00 00 00"}'::jsonb);
select 'audit', operation, action, avant, apres from journal where action='Modification de la fiche';
\echo === fonctions destructives supprimees
select 'anonymiser_donnees absente', to_regprocedure('public.anonymiser_donnees(text,text,boolean)') is null;
select 'apercu_anonymisation absente', to_regprocedure('public.apercu_anonymisation()') is null;
\echo === masques
select 'nom', coop_masque_nom('Jean-Luc Dupont'), coop_masque_nom('D''Hondt Éric'), coop_masque_nom('Lu'), coop_masque_nom(null);
select 'email', coop_masque_email('jean@badjawe.be'), coop_masque_email('pas-un-mail'), coop_masque_email('');
select 'tel', coop_masque_tel('0471 11 22 33'), coop_masque_tel('+32 471 11 22 33'), coop_masque_tel('0032471112233'), coop_masque_tel('');
select 'numero', coop_masque_numero('85.07.30-033.28'), coop_masque_numero('0123.456.749'), coop_masque_numero('');
\echo === contrainte niveau anon
reset role;
select 'anon refusé pour budget' as t; insert into role_permissions values ('user','budget','anon') on conflict (role_id, app_key) do update set level='anon';
select 'rôle prêt à l''emploi', role_id, app_key, level from role_permissions where role_id='coop_anonyme' order by app_key;
update profiles set role='coop_anonyme' where id='00000000-0000-0000-0000-00000000000d';
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000d'; set request.jwt.claims='{"email":"d@x"}';
\echo === PROFIL ANONYME (d)
select 'niveau', app_level('cooperateurs'), coop_est_anonyme(), has_app_access('/apps/cooperateurs'), can_write_cooperateurs(), can_read_cooperateurs();
select 'tables brutes (doivent être 0)', (select count(*) from cooperateurs) c, (select count(*) from contacts) ct, (select count(*) from adresses) a, (select count(*) from cooperateur_demandes) d, (select count(*) from journal) j, (select count(*) from groupes_doublons) g;
select 'données non personnelles', (select count(*) from categories) > 0 cat, (select count(*) from parametres) > 0 par, (select count(*) from mouvements_parts) mv;
select 'vue annuaire / newsletter', (select count(*) from v_annuaire_competences) ann, (select count(*) from v_newsletter_abonnes) nl, (select count(*) from v_journal_evenements) jr;
create temp table v as select coop_vue_anonymisee() j;
grant all on v to public;
select 'nb coops / demandes', jsonb_array_length(j->'coops'), jsonb_array_length(j->'demandes') from v;
select 'fuite de données perso (doit être 0)', count(*) from v where lower(j::text) ~ 'alic|martin|alice@|0471|0499|rue du test|85073003328|0123456749|brasserie du coin|marc@coin|leroy|carl@';
select 'extrait coop', c->>'certificat' cert, c->>'nom' nom, c->>'prenom' prenom, c->>'numero_identification' num, c->'contacts' contacts, c->'adresses'->0->>'rue' rue, c->'adresses'->0->>'ville' ville, c->'categories' cat from v, jsonb_array_elements(j->'coops') c order by 2;
select 'parts conservées', sum((m->>'nombre_parts')::int) from v, jsonb_array_elements(j->'coops') c, jsonb_array_elements(c->'mouvements_parts') m;
select 'extrait demande', d->>'nom' nom, d->>'email' email, d->>'telephone' tel, d->>'reference_bancaire' ref, d->>'nombre_parts' parts from v, jsonb_array_elements(j->'demandes') d order by 2;
\echo === ÉCRITURES REFUSÉES (toutes doivent échouer / 0 ligne)
update cooperateurs set nom='X'; 
delete from cooperateurs;
insert into mouvements_parts(cooperateur_id, date_mouvement, nombre_parts, montant_total) values (1, now(), 5, 1250);
select modifier_cooperateur(1, '{"prenom":"X"}'::jsonb);
select enregistrer_mouvement(1, current_date, 1, 250);
select valider_demande(gen_random_uuid());
select importer_demandes('[]'::jsonb);
select rafraichir_existants();
select detecter_doublons();
select statut_groupe_doublons(1, 'ignore');
select fusionner_cooperateurs(1, 2, '{}'::jsonb);
update role_permissions set level='write' where role_id='coop_anonyme';
update profiles set role='admin' where id='00000000-0000-0000-0000-00000000000d';
update journal set libelle='x';
reset role; select 'rôle de d inchangé', role from profiles where id='00000000-0000-0000-0000-00000000000d'; select 'niveau coop_anonyme inchangé', level from role_permissions where role_id='coop_anonyme' and app_key='cooperateurs'; select 'colonnes texte demandes', string_agg(column_name, ',') from information_schema.columns where table_name='cooperateur_demandes' and data_type in ('text','jsonb'); select 'colonnes texte cooperateurs', string_agg(column_name, ',') from information_schema.columns where table_name='cooperateurs' and data_type in ('text','jsonb');
\echo === admin et autres profils
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a'; set request.jwt.claims='{"email":"a@x"}';
select coop_vue_anonymisee();
select 'admin : niveau', app_level('cooperateurs'), coop_est_anonyme();
select 'admin : données en clair intactes', nom, prenom from cooperateurs order by id;
select 'parts totales', sum(nombre_parts) from mouvements_parts;
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c'; set request.jwt.claims='{"email":"c@x"}';
select coop_vue_anonymisee();
