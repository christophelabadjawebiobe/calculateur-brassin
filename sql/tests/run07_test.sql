\set ON_ERROR_STOP on
\i sql/mock_test.sql
\i sql/01_budget_analyse.sql
\i sql/02_budget_pcmn.sql
\i sql/03_app_state_calculateur.sql
\i sql/04_admin_reel_validation.sql
\i sql/05_roles_permissions.sql
\i sql/06_budget_scenarios.sql
\i sql/07_cooperateurs.sql
\i sql/07_cooperateurs.sql
select 'appli enregistree', count(*) from applications where route='/apps/cooperateurs';
select 'permissions', role_id, level from role_permissions where app_key='cooperateurs' order by 2;
-- a=admin, b=brasseur (aucun acces coop), c=user
update role_permissions set level='read' where role_id='user' and app_key='cooperateurs';
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
select 'import', importer_demandes('[
 {"google_row_id":"r2","date_demande":"2026-10-01T10:00:00Z","nom":"DUPONT","prenom":"Marie","email":"marie@x.be","telephone":"0470","rue":"Rue A","numero":"1","code_postal":"4000","ville":"Liège","numero_national":"85.07.30-033.28","numero_valide":true,"reference_bancaire":"LDF2026 : DUPONT Marie","nombre_parts":4},
 {"google_row_id":"r3","nom":"ACME SRL","representant":"Jean Acme","email":"info@acme.be","numero_national":"0123456749","type_souscripteur":"entreprise","categorie_code":"D","nombre_parts":10},
 {"google_row_id":"r2","nom":"DOUBLON"}]'::jsonb);
select 'doublon ignore', count(*) from cooperateur_demandes;
select 'montant calcule', nom, nombre_parts, montant_total from cooperateur_demandes order by nom;
do $$ begin begin perform valider_demande((select id from cooperateur_demandes where nom='DUPONT')); raise exception 'FAIL sans paiement'; exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK validation refusée sans paiement : %', sqlerrm; end; end $$;
update cooperateur_demandes set paiement_confirme=true where nom='DUPONT';
select 'date paiement auto', date_paiement is not null from cooperateur_demandes where nom='DUPONT';
select 'validation 1', valider_demande((select id from cooperateur_demandes where nom='DUPONT'), '2026-10-05');
update cooperateur_demandes set paiement_confirme=true where nom='ACME SRL';
select 'validation 2', valider_demande((select id from cooperateur_demandes where nom='ACME SRL'), '2026-10-06');
select 'certificats 1 et 2', c.nom, c.certificat, c.numero_identification, ca.code from cooperateurs c join categories ca on ca.id=c.categorie_id order by certificat;
select 'adresse + contacts', (select count(*) from adresses), (select count(*) from contacts);
select 'mouvements', nom, nombre_parts, montant_total, date_mouvement from mouvements_parts m join cooperateurs c on c.id=m.cooperateur_id order by m.id;
select 'ligne verrouillee', nom, is_locked, valide_registre, certificat_numero from cooperateur_demandes order by nom;
do $$ begin begin update cooperateur_demandes set nombre_parts=99 where nom='DUPONT'; raise exception 'FAIL modif verrouillee'; exception when insufficient_privilege then raise notice 'OK modification refusée sur ligne verrouillée'; end; end $$;
do $$ begin begin delete from cooperateur_demandes where nom='DUPONT'; raise exception 'FAIL suppression'; exception when insufficient_privilege then raise notice 'OK suppression refusée'; end; end $$;
update cooperateur_demandes set odoo_mailing_synced=true, brevo_synced=true, certificat_genere=true where nom='DUPONT';
select 'flags de synchro autorises sur ligne verrouillee', odoo_mailing_synced, brevo_synced, certificat_genere from cooperateur_demandes where nom='DUPONT';
do $$ begin begin perform valider_demande((select id from cooperateur_demandes where nom='DUPONT')); raise exception 'FAIL double validation'; exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK double validation refusée : %', sqlerrm; end; end $$;
-- rachat : meme e-mail, autre ligne
select 'import rachat', importer_demandes('[{"google_row_id":"r9","nom":"DUPONT","prenom":"Marie","email":"MARIE@x.be","numero_national":"","nombre_parts":2,"reference_bancaire":"LDF2026 : DUPONT Marie"}]'::jsonb);
select 'rachat detecte', is_existing_coop, existing_coop_id from cooperateur_demandes where google_row_id='r9';
update cooperateur_demandes set paiement_confirme=true where google_row_id='r9';
select 'validation rachat', valider_demande((select id from cooperateur_demandes where google_row_id='r9'));
select 'meme fiche, certificat inchange', count(*), max(certificat) from cooperateurs;
select 'total parts DUPONT', total_parts, capital from v_parts_par_cooperateur v join cooperateurs c on c.id=v.cooperateur_id where c.nom='DUPONT';
select 'parts en circulation', coop_parts_en_circulation('2026-12-31');
-- deverrouillage : motif obligatoire, admin seulement
do $$ begin begin perform deverrouiller_demande((select id from cooperateur_demandes where nom='DUPONT' and google_row_id='r2'), ''); raise exception 'FAIL motif'; exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK motif obligatoire'; end; end $$;
select deverrouiller_demande((select id from cooperateur_demandes where google_row_id='r2'), 'Faute de frappe sur le téléphone');
update cooperateur_demandes set telephone='0471' where google_row_id='r2';
select 'deverrouille + corrige', is_locked, telephone from cooperateur_demandes where google_row_id='r2';
select reverrouiller_demande((select id from cooperateur_demandes where google_row_id='r2'));
select 'reverrouille', is_locked from cooperateur_demandes where google_row_id='r2';
-- journal
select 'journal', operation, table_nom, action, count(*) from journal group by 1,2,3,4 order by 3,2,4;
select 'evenement deverrouillage', libelle, apres from journal where operation='EVENEMENT';
select 'utilisateur journal', distinct_u from (select distinct utilisateur distinct_u from journal) q;
do $$ begin begin update journal set action='x'; raise exception 'FAIL journal'; exception when insufficient_privilege then raise notice 'OK journal : aucun droit de modification'; end; end $$;
reset role; do $$ begin begin update journal set action='x'; raise exception 'FAIL journal'; exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK journal en lecture seule (déclencheur)'; end; end $$;
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
-- valorisation
insert into valorisations_annuelles(date_cloture,nombre_parts,valeur_nominale,capital,reserves,resultat_exercice,capitaux_propres,valeur_comptable_part) values ('2025-12-31',16,250,4000,100,-50,4050,253.125);
select 'valorisation journalisee', count(*) from journal where table_nom='valorisations_annuelles';

-- classes (statuts) + % du capital
select 'classes', code, libelle from categories order by code;
select 'pct capital', c.nom, v.total_parts, v.pct_capital from v_parts_par_cooperateur v join cooperateurs c on c.id=v.cooperateur_id order by c.id;
-- doublons & foyers
insert into cooperateurs(nom,prenom,categorie_id) select 'MARTIN','Luc',id from categories where code='B';
insert into cooperateurs(nom,prenom,categorie_id) select 'Luc','Martin',id from categories where code='B';
insert into cooperateurs(nom,prenom,categorie_id) select 'DURAND','Anne',id from categories where code='B';
insert into cooperateurs(nom,prenom,categorie_id) select 'DURAND','Paul',id from categories where code='B';
insert into cooperateurs(nom,prenom,categorie_id) select 'ZED','Zoe',id from categories where code='B';
insert into cooperateurs(nom,prenom,categorie_id) select 'DUPONT','Marie',id from categories where code='B';
insert into contacts(cooperateur_id,type,valeur,principal) select id,'email','l@x.be',true from cooperateurs where nom='MARTIN';
insert into contacts(cooperateur_id,type,valeur,principal) select id,'email','L@X.BE',true from cooperateurs where nom='Luc';
insert into contacts(cooperateur_id,type,valeur,principal) select id,'telephone','0471 11 22 33',true from cooperateurs where nom='MARTIN';
insert into contacts(cooperateur_id,type,valeur,principal) select id,'telephone','+32 471 11 22 33',true from cooperateurs where nom='Luc';
insert into contacts(cooperateur_id,type,valeur,principal) select id,'email','marie@x.be',true from cooperateurs where nom='DUPONT' and certificat is null;
insert into adresses(cooperateur_id,type,rue,numero,code_postal,ville) select id,'principale','Rue des Fleurs','9','4000','Liège' from cooperateurs where nom='DURAND';
insert into adresses(cooperateur_id,type,rue,numero,code_postal,ville) select id,'principale','Rue de la Gare','2','4020','Liège' from cooperateurs where nom in ('MARTIN','ZED');
insert into mouvements_parts(cooperateur_id,date_mouvement,nombre_parts) select id,'2024-01-01',4 from cooperateurs where nom='MARTIN';
insert into mouvements_parts(cooperateur_id,date_mouvement,nombre_parts) select id,'2024-01-01',4 from cooperateurs where nom='Luc';
insert into mouvements_parts(cooperateur_id,date_mouvement,nombre_parts) select id,'2025-02-02',1 from cooperateurs where nom='Luc';
insert into mouvements_parts(cooperateur_id,date_mouvement,nombre_parts) select id,'2025-03-03',2 from cooperateurs where nom='DUPONT' and certificat is null;
select 'detection', detecter_doublons();
select 'groupes', g.id, g.type, g.score, g.raisons, (select string_agg(c.nom||' '||coalesce(c.prenom,''), ' | ' order by c.id) from groupes_doublons_membres m join cooperateurs c on c.id=m.cooperateur_id where m.groupe_id=g.id) from groupes_doublons g order by g.id;
select 'detection idempotente', detecter_doublons();
select 'ecarter ZED/autres', statut_groupe_doublons((select g.id from groupes_doublons g where g.type='foyer possible'), 'ignore');
select 'detection garde ecarte', detecter_doublons(), (select count(*) from groupes_doublons where statut='ignore');
-- fusion MARTIN / Luc : on garde MARTIN, on decoche la ligne en double (id du mouvement de Luc du 2024)
select 'fusion', fusionner_cooperateurs(
   (select m.groupe_id from groupes_doublons_membres m join cooperateurs c on c.id=m.cooperateur_id where c.nom='MARTIN'),
   (select id from cooperateurs where nom='MARTIN'), '{"prenom":"Luc"}'::jsonb,
   (select array_agg(mv.id) from mouvements_parts mv join cooperateurs c on c.id=mv.cooperateur_id where c.nom in ('MARTIN','Luc') and not (c.nom='Luc' and mv.date_mouvement='2024-01-01')),
   null, null, (select array_agg(id) from cooperateurs where nom='Luc'));
select 'apres fusion MARTIN', c.nom, c.prenom, c.remarques, v.total_parts from cooperateurs c join v_parts_par_cooperateur v on v.cooperateur_id=c.id where c.nom in ('MARTIN','Luc');
select 'contacts fusion', type, valeur, principal from contacts where cooperateur_id=(select id from cooperateurs where nom='MARTIN') order by type, id;
select 'journal fusion', operation, table_nom, action from journal where action like 'Fusion de doublons%' order by id;
-- fusion qui rattache des demandes verrouillees : DUPONT (cert. 1, demandes verrouillees) absorbe la fiche sans certificat
select 'fusion DUPONT', fusionner_cooperateurs(
   (select m.groupe_id from groupes_doublons_membres m join cooperateurs c on c.id=m.cooperateur_id where c.nom='DUPONT' and c.certificat=1),
   (select id from cooperateurs where nom='DUPONT' and certificat=1), '{}'::jsonb, null, null, null);
select 'demandes toujours verrouillees et rattachees', count(*) filter (where is_locked), count(*) filter (where cooperateur_id=(select id from cooperateurs where certificat=1)) from cooperateur_demandes where nom='DUPONT';
select 'groupes restants', statut, count(*) from groupes_doublons group by statut order by statut;
do $$ begin begin perform fusionner_cooperateurs(999999, 1); raise exception 'FAIL groupe inconnu'; exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK groupe inconnu refusé'; end; end $$;
-- droits : brasseur (b) sans acces, user (c) lecture seule
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
select 'brasseur voit', (select count(*) from cooperateurs), (select count(*) from cooperateur_demandes);
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
select 'user (lecture) voit', (select count(*) from cooperateurs), (select count(*) from cooperateur_demandes), (select count(*) from journal);
do $$ begin begin insert into cooperateurs(nom) values ('X'); raise exception 'FAIL ecriture user'; exception when insufficient_privilege then raise notice 'OK écriture refusée au lecteur'; end; end $$;
do $$ begin begin perform valider_demande(gen_random_uuid()); raise exception 'FAIL rpc user'; exception when insufficient_privilege then raise notice 'OK rpc refusée au lecteur'; end; end $$;
do $$ begin begin perform deverrouiller_demande(gen_random_uuid(),'x'); raise exception 'FAIL deverrouiller user'; exception when insufficient_privilege then raise notice 'OK déverrouillage réservé admin'; end; end $$;
reset role; reset request.jwt.claim.sub;
set role anon; do $$ begin begin perform count(*) from cooperateurs; raise exception 'FAIL anon'; exception when insufficient_privilege then raise notice 'OK anon refusé'; end; end $$;

-- rattrapage d'une ancienne version (C = Entreprises, D = Institutions) : bascule des fiches et des demandes
reset role;
update categories set libelle='Entreprises' where code='C'; update categories set libelle='Institutions' where code='D';
\i sql/07_cooperateurs.sql
select 'apres rattrapage', c.nom, ca.code, ca.libelle from cooperateurs c join categories ca on ca.id=c.categorie_id where c.nom='ACME SRL';
select 'demande ACME', categorie_code from cooperateur_demandes where nom='ACME SRL';
select 'classes finales', code, libelle from categories order by code;
