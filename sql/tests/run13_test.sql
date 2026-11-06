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
\i sql/13_cooperateurs_competences.sql
\set ON_ERROR_STOP off
-- fiche existante (avant migration de profil) + coop validée avant migration avec donnees_brutes
insert into cooperateurs(nom,prenom,categorie_id,certificat) values ('Dupont','Jean',(select id from categories where code='B'),50);
insert into contacts(cooperateur_id,type,valeur,principal) values (1,'email','dup@x.be',true),(1,'telephone','0470 00 00 01',true);
insert into mouvements_parts(cooperateur_id,date_mouvement,nombre_parts) values (1,'2024-01-01',2);
insert into cooperateurs(nom,prenom,categorie_id,certificat) values ('Ancien','Zoe',(select id from categories where code='B'),51);
insert into mouvements_parts(cooperateur_id,date_mouvement,nombre_parts) values (2,'2024-01-01',1);
insert into cooperateur_demandes(google_row_id,nom,prenom,nombre_parts,valide_registre,is_locked,cooperateur_id,paiement_confirme,donnees_brutes)
 values ('old1','Ancien','Zoe',1,true,true,2,true,'{"Métier / Profession":"Brasseuse","Compétences, talents et savoir-faire que vous souhaitez mettre au service de la coopérative":"bière, graphisme","Acceptez-vous d''être contacté(e) par téléphone en cas de besoin de vos compétences pour la coopérative ?":"Oui","Autre":"x"}');
\i sql/13_cooperateurs_competences.sql
select 'backfill Zoe', profession, competences, accord_contact_tel, profil_source from cooperateurs where id=2;
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a'; set request.jwt.claims='{"email":"a@x"}';
select 'import', importer_demandes('[
 {"google_row_id":"A","nom":"Martin","prenom":"Alice","email":"alice@x.be","telephone":"0471 11 11 11","nombre_parts":2,"profession":"Menuisière","competences":"menuiserie, électricité","accord_contact_tel":true},
 {"google_row_id":"B","nom":"Bob","prenom":"Bob","email":"bob@x.be","telephone":"0472","nombre_parts":1,"profession":"Comptable","competences":"comptabilité","accord_contact_tel":false},
 {"google_row_id":"C","nom":"Carl","prenom":"Carl","email":"carl@x.be","nombre_parts":1},
 {"google_row_id":"D","nom":"Dupont","prenom":"Jean","email":"dup@x.be","nombre_parts":1,"profession":"Électricien","competences":"électricité","accord_contact_tel":true},
 {"google_row_id":"E","nom":"Eve","prenom":"Eve","email":"eve@x.be","nombre_parts":1}
]'::jsonb);
select 'reimport E enrichi', importer_demandes('[{"google_row_id":"E","nom":"Eve","prenom":"Eve","email":"eve@x.be","nombre_parts":1,"profession":"Juriste","competences":"droit","accord_contact_tel":true},{"google_row_id":"A","nom":"Martin","prenom":"Alice","profession":"AUTRE","competences":"autre","accord_contact_tel":false}]'::jsonb);
select 'demandes', google_row_id, profession, accord_contact_tel from cooperateur_demandes where google_row_id in ('A','E') order by 2;
update cooperateur_demandes set paiement_confirme=true where google_row_id in ('A','B','C','D','E');
select 'valider', google_row_id, valider_demande(id)->>'nouveau' from cooperateur_demandes where google_row_id in ('A','B','C','D','E') order by 2;
select 'fiches', nom, profession, competences, accord_contact_tel, profil_source from cooperateurs order by id;
select 'annuaire', nom, prenom, profession, competences, telephone, email, parts from v_annuaire_competences order by nom;
-- retrait du consentement : Alice se réinscrit en répondant Non
select 'import2', importer_demandes('[{"google_row_id":"A2","nom":"Martin","prenom":"Alice","email":"alice@x.be","nombre_parts":1,"profession":"Menuisière","accord_contact_tel":false}]'::jsonb);
update cooperateur_demandes set paiement_confirme=true where google_row_id='A2';
select 'valider A2', valider_demande(id)->>'nouveau' from cooperateur_demandes where google_row_id='A2';
select 'annuaire apres Non', nom from v_annuaire_competences order by nom;
select 'journal profil', type_evenement, action, operation from v_journal_evenements where table_nom='cooperateurs' and operation='UPDATE' order by id desc limit 3;
-- lecteur sans droit coop : ne voit rien
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c'; set request.jwt.claims='{"email":"c@x"}';
select 'user sans acces', count(*) from v_annuaire_competences;
