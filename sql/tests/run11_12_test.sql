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
\i sql/11_cooperateurs_audit_mouvements.sql
\i sql/12_budget_audit_verrous_invest.sql
\i sql/12_budget_audit_verrous_invest.sql
\set ON_ERROR_STOP off
-- COOP : admin a (role admin => ecriture)
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
set request.jwt.claims='{"email":"a@x"}';
select 'coop', (select count(*) from categories);
reset role;
insert into cooperateurs(nom,prenom,categorie_id) values ('Dupont','Jean',(select id from categories where code='B'));
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a'; set request.jwt.claims='{"email":"a@x"}';
select 'souscription +4', enregistrer_mouvement((select id from cooperateurs limit 1), '2026-11-05', 4, null);
select 'retrait -2', enregistrer_mouvement((select id from cooperateurs limit 1), '2026-11-05', -2, null);
select 'retrait -2 montant positif force', enregistrer_mouvement((select id from cooperateurs limit 1), '2026-11-06', -1, 250);
select 'retrait -9 (trop)', enregistrer_mouvement((select id from cooperateurs limit 1), '2026-11-06', -9, null);
select 'zero', enregistrer_mouvement((select id from cooperateurs limit 1), '2026-11-06', 0, null);
select 'mouvements', nombre_parts, montant_total from mouvements_parts order by id;
select 'detect', detecter_doublons();
select 'journal types', type_evenement, action, operation, utilisateur, cooperateur_nom from v_journal_evenements order by id;
select 'users', * from v_journal_utilisateurs;
-- trigger sign: update with wrong sign
reset role; update mouvements_parts set montant_total=500 where nombre_parts=-2; select 'sign fix', nombre_parts, montant_total from mouvements_parts order by id;
-- BUDGET
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a'; set request.jwt.claims='{"email":"a@x"}';
insert into pcmn_budget_plans(year,scenario,title,data) values (2027,'base','Budget 2027','{"v":1,"rows":{"700000":{"mode":"annual","annual":12000,"months":[0,0,0,0,0,0,0,0,0,0,0,0],"subs":[]},"600000":{"mode":"monthly","annual":0,"months":[100,100,100,100,100,100,100,100,100,100,100,100],"subs":[]}}}');
update pcmn_budget_plans set data='{"v":1,"rows":{"700000":{"mode":"annual","annual":13200,"months":[0,0,0,0,0,0,0,0,0,0,0,0],"subs":[]},"600000":{"mode":"monthly","annual":0,"months":[100,100,150,100,100,100,100,100,100,100,100,100],"subs":[{"id":"x","label":"s","mode":"monthly","annual":0,"months":[5,0,0,0,0,0,0,0,0,0,0,0]}]}}}' where year=2027;
select 'log', type, compte, mois, ancien, nouveau, ecart, utilisateur, libelle from budget_modifications_log order by id;
select 'upd log (doit echouer)'; update budget_modifications_log set ecart=0;
-- locks : a prend, b (brasseur) bloque
select 'lock a', budget_lock_take(2027,'base','sessionAAAA1');
select 'lock a renew', (budget_lock_take(2027,'base','sessionAAAA1'))->>'ok';
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b'; set request.jwt.claims='{"email":"b@x"}';
select 'lock b (bloque)', budget_lock_take(2027,'base','sessionBBBB1');
update pcmn_budget_plans set data='{"v":1,"rows":{}}' where year=2027;
select 'b update bloque rows', (select count(*) from pcmn_budget_plans where data='{"v":1,"rows":{}}'::jsonb);
select 'b force', (budget_lock_take(2027,'base','sessionBBBB1', true))->>'ok';
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a'; set request.jwt.claims='{"email":"a@x"}';
update pcmn_budget_plans set data='{"v":1,"rows":{"700000":{"mode":"annual","annual":1,"months":[0,0,0,0,0,0,0,0,0,0,0,0],"subs":[]}}}' where year=2027;
select 'a apres force (refus attendu: 0 ligne mise a jour)', (select count(*) from pcmn_budget_plans where data->'rows'->'700000'->>'annual'='1');
select 'filtres', budget_journal_filtres();
-- user c (role user) : pas d ecriture budget
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c'; set request.jwt.claims='{"email":"c@x"}';
select 'lock c', budget_lock_take(2027,'base','sessionCCCC1');
insert into budget_immobilisations(libelle,date_service,duree_annees,montant_htva) values ('x','2026-03-01',5,1000);
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a'; set request.jwt.claims='{"email":"a@x"}';
insert into budget_immobilisations(libelle,date_service,duree_annees,montant_htva) values ('Cuve','2026-03-01',10,50000);
insert into budget_emprunts(organisme,capital,mensualite,date_premiere_echeance,date_fin) values ('Credal',50000,1000,'2025-02-01','2030-01-01');
select 'invest', libelle, compte, statut from budget_immobilisations; select 'emprunt', organisme, compte_interets from budget_emprunts;
select 'release', budget_lock_release(2027,'base','sessionAAAA1');
