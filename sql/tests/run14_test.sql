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
\i sql/14_cooperateurs_cadeau_rgpd.sql
\set ON_ERROR_STOP off
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a'; set request.jwt.claims='{"email":"a@x"}';
select 'import', importer_demandes('[
 {"google_row_id":"A","nom":"Martin","prenom":"Alice","email":"alice@x.be","telephone":"0471","nombre_parts":2,"est_cadeau":false,"consentement_newsletter":true,"newsletter_repondu":true},
 {"google_row_id":"B","nom":"Dupont","prenom":"Paul","email":"paul@x.be","nombre_parts":1,"est_cadeau":true,"beneficiaire_nom":"Dupont","beneficiaire_prenom":"Léa","beneficiaire_date_naissance":"2016-03-12","beneficiaire_lien":"Parent","beneficiaire_email":"lea@x.be","consentement_newsletter":false,"newsletter_repondu":true},
 {"google_row_id":"C","nom":"Carl","prenom":"Carl","email":"carl@x.be","nombre_parts":1},
 {"google_row_id":"D","nom":"Zed","prenom":"Zed","email":"zed@x.be","nombre_parts":1,"est_cadeau":false,"beneficiaire_nom":"Fantome","consentement_newsletter":true,"newsletter_repondu":true}
]'::jsonb);
select 'demandes', google_row_id, est_cadeau, beneficiaire_prenom, beneficiaire_date_naissance, consentement_newsletter, newsletter_repondu from cooperateur_demandes order by 2;
select 'reimport (A jamais écrasée, C complétée)', importer_demandes('[{"google_row_id":"A","nom":"Martin","est_cadeau":true,"beneficiaire_prenom":"X","consentement_newsletter":false,"newsletter_repondu":true},{"google_row_id":"C","nom":"Carl","est_cadeau":true,"beneficiaire_prenom":"Kid","consentement_newsletter":true,"newsletter_repondu":true}]'::jsonb);
select 'apres reimport', google_row_id, est_cadeau, beneficiaire_prenom, consentement_newsletter from cooperateur_demandes where google_row_id in ('A','C') order by 2;
update cooperateur_demandes set paiement_confirme=true;
select 'valider', google_row_id, valider_demande(id)->>'nouveau' from cooperateur_demandes order by 2;
select 'fiches', nom, est_cadeau, beneficiaire_prenom, beneficiaire_date_naissance, beneficiaire_lien, beneficiaire_email, consentement_newsletter from cooperateurs order by id;
select 'newsletter', nom, email from v_newsletter_abonnes order by nom;
-- Alice se réinscrit en répondant Non : retrait du consentement ; Paul sans réponse : inchangé ; Paul fait un 2e cadeau
select 'import2', importer_demandes('[{"google_row_id":"A2","nom":"Martin","prenom":"Alice","email":"alice@x.be","nombre_parts":1,"consentement_newsletter":false,"newsletter_repondu":true},
 {"google_row_id":"B2","nom":"Dupont","prenom":"Paul","email":"paul@x.be","nombre_parts":1,"est_cadeau":true,"beneficiaire_nom":"Dupont","beneficiaire_prenom":"Tom","beneficiaire_date_naissance":"2018-05-01","beneficiaire_lien":"Parent"},
 {"google_row_id":"E","nom":"Zed","prenom":"Zed","email":"zed@x.be","nombre_parts":1}]'::jsonb);
update cooperateur_demandes set paiement_confirme=true where google_row_id in ('A2','B2','E');
select 'valider2', google_row_id, valider_demande(id)->>'nouveau' from cooperateur_demandes where google_row_id in ('A2','B2','E') order by 2;
select 'fiches 2', nom, est_cadeau, beneficiaire_prenom, consentement_newsletter from cooperateurs order by id;
select 'newsletter 2', nom from v_newsletter_abonnes order by nom;
select 'ligne validee non modifiable par import', importer_demandes('[{"google_row_id":"A","nom":"Martin","est_cadeau":true}]'::jsonb);
reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c'; set request.jwt.claims='{"email":"c@x"}';
select 'user sans acces', count(*) from v_newsletter_abonnes;
