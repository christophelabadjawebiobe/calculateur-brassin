# Projet Next.js (App Router) + Supabase : mise en place

Arborescence (à la racine du dépôt) :

    app/layout.tsx  app/page.tsx  app/globals.css
    app/login/page.tsx  app/dashboard/page.tsx
    app/apps/{budget,analyse,calculateur}/…   app/admin/users/…   app/reset-password/page.tsx
    lib/{pcmn,xlsx-lite,tabular,access}.ts  lib/supabase/{client,server,admin}.ts  components/{AppHeader,AppIcon,LedgerImport}.tsx
    middleware.ts  tsconfig.json  package.json  tailwind.config.ts  postcss.config.mjs

1. Copier le contenu du ZIP à la racine du projet (`middleware.ts` à côté de `package.json`, PAS dans `app/`),
   puis `npm install`.
2. Variables d'environnement (Vercel > Settings > Environment Variables, et `.env.local` en local) :
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (voir `.env.example`). Redéployer après ajout.
   Pour la page Admin : `SUPABASE_SERVICE_ROLE_KEY` (Supabase > Project Settings > API > service_role ; **serveur uniquement**,
   jamais en `NEXT_PUBLIC_`). Facultatif : `NEXT_PUBLIC_SITE_URL` (adresse publique du site, utilisée dans les liens de réinitialisation).
   Supabase > Authentication > URL Configuration > Redirect URLs : ajouter `https://VOTRE-DOMAINE/reset-password`.
3. Supabase > SQL Editor : exécuter, dans l'ordre (tous rejouables) :
   - `sql/01_budget_analyse.sql` : droits (`is_admin`, `can_edit`, `has_app_access`…) et ancien module Budget/Analyse ;
   - `sql/02_budget_pcmn.sql` : module Budget PCMN (tables `pcmn_budget_plans` et `pcmn_budget_history`,
     réalisé 2023-2025 et budget 2026 de départ tirés de « creation budjet.xlsx ») ;
   - `sql/03_app_state_calculateur.sql` : base partagée du Calculateur (`app_state`), droits lus dans `profiles`.
   - `sql/04_admin_reel_validation.sql` : administration des utilisateurs (droits de l'admin sur `profiles` et
     `user_app_permissions`), réalisé mensuel `pcmn_actuals`, budget validé (`validated_data`, fonction
     `validate_pcmn_budget`), import d'une année ouvert aux éditeurs, noms des tuiles (Reporting, Budget, Recette, Admin).
4. `applications.route` doit valoir `/apps/budget`, `/apps/analyse`, `/apps/calculateur`.
   Le tableau de bord lit les colonnes `name` (ou `title`/`label`), `description` et `icon` si elles existent.
5. Donner l'accès via les rôles (onglet « Gestion des rôles » de `/admin/users`) ; le rôle `admin` voit tout.
6. `git push` : Vercel déploie. Tester avec admin, brasseur et utilisateur en lecture.

Écriture : rôles `admin` et `brasseur` (fonction `can_edit()` à adapter).

## Charte graphique et en-tête
`app/globals.css` contient les variables de la charte « La Badjawe » (`--brand`, `--brand-2`, `--bg`, `--surface`…) et le style de l'en-tête.
`components/AppHeader.tsx` est l'en-tête collant (fond #012735, filet ambre 3 px, logo `public/badjawe-logo.png`) ;
remplacez le logo en déposant votre fichier au même nom. Les polices (Bricolage Grotesque, IBM Plex Sans, IBM Plex Mono)
sont chargées par `<link>` dans `app/layout.tsx`.

## Calculateur (`app/apps/calculateur/page.tsx`)
Composant client unique : 4 onglets, formules reprises à l'identique de la version HTML. État partagé dans `app_state` (ligne `main`),
copie locale dans le navigateur. Le rôle vient de `profiles.role` (admin / brasseur / user). L'analyse annuelle est réservée aux admins.
Le fichier commence par `// @ts-nocheck` : le noyau de calcul est du JavaScript repris tel quel.

## Budget (`app/apps/budget/page.tsx`)
Plan comptable PCMN du fichier Excel ; année budgétaire au choix (sélecteur ; 2026 par défaut, `DEFAULT_YEAR` en tête de fichier) ;
mois, trimestres T1 à T4 (interrupteur « Trimestres »), total ; saisie mensuelle ou annuelle ; variation en % ; sous-lignes de détail ;
KPI en temps réel. Le budget est enregistré dans `pcmn_budget_plans` (un document JSON par année).
- **Commentaires** : colonne « Commentaire » sur chaque compte et chaque sous-ligne (interrupteur pour la masquer ; le champ reste alors disponible dans le panneau du compte). Stockés dans le JSON du plan (`comment`).
- **Années de référence** : une puce par année du réalisé (`pcmn_budget_history`) pour déplier/replier sa colonne ; la colonne « vs » compare à l'année précédente la plus proche.
- **Importer une année** : (1) charge un export Odoo / Excel / CSV (grand livre, tableau croisé à 12 mois ou balance annuelle) dans `pcmn_budget_history` (total annuel) et `pcmn_actuals` (mensuel) ; (2) « Reprendre comme base » copie une année (avec sa saisonnalité si le mensuel est connu, ± un %) dans le budget, sur les lignes vides ou en remplacement, annulable.
- **Export** : Excel (.xlsx : feuilles Budget, Commentaires, Informations) et CSV, avec toutes les années de référence et les commentaires.
- **Validation** : un administrateur fige le budget (`validate_pcmn_budget`) ; l'analyse compare au réalisé cette copie figée (ou au brouillon, signalé).

## Reporting (`app/apps/analyse/`)
`AnalyseApp.tsx` (page cliente), `CaChart.tsx` (graphiques SVG interactifs sans dépendance), `compute.ts` (calculs purs).
Courbes mensuelles du CA (ou marge brute, EBITDA, résultat…), superposition d'autres années, cumul, vue détaillée par compte / ligne de détail du budget,
tableau réalisé / budget / N-1 au mois, au trimestre ou à l'année (trimestres masquables), import du réalisé Odoo.
La comparaison à N-1 mois par mois exige d'avoir importé le réalisé mensuel de l'année précédente (sinon seul le total annuel est comparé).

## Admin (`app/admin/users/`) et mot de passe
Page réservée au rôle `admin` (contrôle serveur dans la page, dans chaque action serveur, et RLS). Liste des comptes, rôle (admin / brasseur / user),
accès par application, et réinitialisation du mot de passe : e-mail Supabase, lien à transmettre, ou mot de passe temporaire.
Les e-mails, dernières connexions, liens et mots de passe temporaires demandent `SUPABASE_SERVICE_ROLE_KEY`. La page `/reset-password` (publique) reçoit le lien.
L'ancienne adresse `/dashboard/users` redirige vers `/admin/users`. Si la page affichait une erreur, la cause la plus fréquente est une politique RLS
de `profiles` qui se référence elle-même (récursion) : `04_admin_reel_validation.sql` ajoute des politiques basées sur `is_admin()` (SECURITY DEFINER) ;
supprimez au besoin l'ancienne politique fautive (Supabase > Authentication > Policies > profiles).

## Rôles dynamiques et invitations (`sql/05_roles_permissions.sql`)
Exécuter `sql/05` après le 04 (idempotent). Tables `roles` et `role_permissions` : par rôle et par application (`calculateur`, `budget`, `analyse`),
niveau Aucun / Lecture seule / Modification complète, appliqué par la RLS (`app_level()`). Rôles système : admin, brasseur, user (non supprimables) ;
un rôle personnalisé ne peut être supprimé que s'il n'a plus d'utilisateur. `/admin/users` : onglet « Utilisateurs » (recherche, filtre, invitation par e-mail,
renvoi, réinitialisation par e-mail/lien/mot de passe temporaire, suspension, suppression) et onglet « Gestion des rôles ».
Invitations, suspension, suppression et statuts exigent `SUPABASE_SERVICE_ROLE_KEY` ; l'URL de retour des e-mails est `NEXT_PUBLIC_SITE_URL/reset-password`
(à déclarer dans Supabase > Authentication > URL Configuration > Redirect URLs). Les cases d'accès par utilisateur ont été remplacées par la matrice des rôles
(les anciens droits `user_app_permissions` restent honorés en lecture).

## Assistants du Budget (RH, CA par secteur, achats 60, charges fixes 61)
Bouton « Assistants » de la page Budget (`app/apps/budget/Assistants.tsx`, données et calculs dans `lib/defaults.ts` et `lib/defaults-data.ts`).
- **RH** : 4 collaborateurs du journal de paie UCM n°20 (octobre 2026), ventilés par ligne de détail dans les comptes 620201, 621020, 623100, 623210, 623270, 623280… ;
  coefficient CP 220 = 12 + 0,92 (double pécule, mai) + 1,00 (prime de fin d'année, décembre) = 13,92 mois, provisionné chaque mois (625020) et repris au paiement (625120).
- **CA par secteur** : clés 2025 (H 25,14 %, F 19,28 %, D 13,32 %…), objectif annuel ou mensuel, saisonnalité 2024/2025, montants ajustables (verrouillage).
- **Achats (60)** : 30,2 % du CA (fourchette 28–33 %), réparti selon la structure réelle des comptes 2025-2026 ; variations de stock mises à zéro.
- **Charges fixes (61)** : loyer et charges d'Alleur, énergie, assurances, abonnements, maintenance (montants mensuels issus du grand livre 2026, modifiables).
Chaque application passe par « ↶ Annuler ». Les valeurs saisies (collaborateurs, ratio, charges) sont mémorisées dans le navigateur.
`lib/defaults-data.ts` a été calculé à partir des grands livres 2024-2026 : à mettre à jour à la main après de nouveaux exports.

## Scénarios, verrouillage et projection 3 ans (`sql/06_budget_scenarios.sql`)
- Exécuter `sql/06_budget_scenarios.sql` dans Supabase après les scripts 02 et 04 (idempotent). Il ajoute `scenario`, `title` et `is_locked` à `pcmn_budget_plans`, passe la clé primaire à `(year, scenario)` et verrouille les budgets déjà validés. Sans ce script, le Budget reste utilisable en mode « une année = un budget ».
- Budget : choix de l'année et du scénario, « ➕ Nouveau scénario », « 📋 Dupliquer le budget », badge « Brouillon » / « Validé & Verrouillé » (saisie refusée aussi par la base), « 🔄 Réinitialiser 2026 aux chiffres réels » (10 mois comptables = 302 781,46 € HTVA + novembre/décembre extrapolés = 380 560 € HTVA).
- Assistant RH : 5 salariés (Stanislas HERMAN, directeur jusqu'au 31/12/2026, absent de 2027 ; réintégré sur le 4e trimestre 2026 dans l'atterrissage ; Noah MENTION sous contrat jusqu'en septembre 2028), consultance management du dirigeant 6 000 €/mois (compte 618000) et droits d'auteur 50 000 €/an (compte 613400, lissés), tous deux dans la section « Personnel externe » (consultances externes).
- Page `/apps/budget/analyse` (« Projection 3 ans ») : trois budgets au choix (par défaut 2026-2027-2028, verrouillé > scénario `base`), ratios en % du CA et en % de la marge brute, seuil de rentabilité, graphiques SVG sans dépendance. La page Reporting retient un budget par année (verrouillé > `base` > premier).

## Mise en production du module Coopérateurs (ordre des scripts)
1. `sql/07_cooperateurs.sql` (schéma, doublons, workflow) ; 2. `sql/07b_cooperateurs_acces.sql` si la tuile ou la ligne « Coopérateurs » manque dans Admin > Rôles (rejouable, indépendant) ;
3. `sql/08_seed_cooperateurs.sql` : import initial du registre de Sam (une seule fois ; refuse de s'exécuter si des fiches existent déjà ; recale les séquences ; le prochain certificat est MAX + 1).
   Pour régénérer ce script depuis une autre version de la base SQLite : `python3 scripts/sqlite_vers_seed.py registre_cooperateurs_normalise.sqlite sql/08_seed_cooperateurs.sql` (bibliothèque standard, sans installation).
4. Variables Vercel et activation de Google Sheet / Odoo / Brevo : **docs/GUIDE_ACTIVATION_CONNECTEURS.md** (bouton « 🩺 Tester les connecteurs » dans l'onglet Souscriptions).
5. Accès : Admin > Rôles > « Coopérateurs » (Aucun / Lecture seule / Modification complète) ; la liste des applications est définie dans `lib/types.ts` (`APP_META`).

## Gestion des Coopérateurs (`/apps/cooperateurs`, `sql/07_cooperateurs.sql`)
- Exécuter `sql/07_cooperateurs.sql` dans Supabase (idempotent ; tables `categories`, `cooperateurs`, `mouvements_parts`, `adresses`, `contacts`, `parametres`, `valorisations_annuelles`, `journal`, `journal_contexte`, `cooperateur_demandes`). Attention : vérifier qu'aucune table existante ne porte déjà l'un de ces noms. Puis `npm install` (nouvelle dépendance `pdf-lib`).
- Accès : seul l'admin y accède par défaut ; ouvrir l'application aux autres rôles dans Admin > Rôles (Coopérateurs : lecture / modification).
- Variables d'environnement (voir `.env.example`) : `GOOGLE_SHEET_ID` (+ `GOOGLE_API_KEY` ; le Sheet doit être partagé « toute personne disposant du lien » ou lisible avec la clé), `ODOO_URL`, `ODOO_API_KEY` (+ `ODOO_DB`, `ODOO_USER`, `ODOO_SIGN_TEMPLATE_ID`, `ODOO_SIGN_ROLE_ID`, `ODOO_MAILING_LIST_NAME`), `BREVO_API_KEY` (+ `BREVO_LIST_ID`, `BREVO_SENDER_EMAIL`). Sans ces variables, chaque connecteur fonctionne en **mode simulation** (identifiants `SIM-…`, aucun appel externe).
- Workflow : synchronisation Google Sheet / import CSV → envoi Odoo Sign → paiement confirmé (date automatique) → « Valider dans le registre » (certificat MAX+1 pour un nouveau coopérateur, simple mouvement pour un existant, synchro Odoo + Brevo, ligne verrouillée). Seul un admin peut déverrouiller (motif obligatoire, tracé dans le journal ; le registre n'est pas annulé).
- **Classes de parts (statuts)** : A = Garant (fondateur, sans certificat numéroté), B = Personne physique, C = Institutionnel, D = Entreprise (personnes morales, sociétés, ASBL). Si une première version du script (C « Entreprises », D « Institutions ») avait déjà été exécutée, la ré-exécution corrige les libellés ET bascule automatiquement les fiches et demandes déjà enregistrées. L'import Google Sheet classe en C les mentions institution / commune / CPAS / pouvoir public / fonds / fondation…, en D les autres personnes morales (entreprise, société, ASBL), en B les personnes physiques ; une lettre explicite (« classe C ») dans le formulaire prime.
- **Doublons & Foyers** (5e onglet) : tables `groupes_doublons` et `groupes_doublons_membres`. « Détecter les doublons » regroupe les fiches partageant e-mail, téléphone, nom (sans ordre ni accents) ou adresse ; « Fusionner les fiches… » reprend la fusion contrôlée de Sam (fiche conservée, identité finale, lignes de parts / adresses / contacts à garder). Les fiches absorbées sont supprimées, leur contenu complet reste dans le journal d'audit (+ événement « Fusion de doublons »). Les demandes déjà validées sont re-rattachées à la fiche conservée.
- **Exports** (Registre et Statistiques) : « 📥 Exporter le Registre (Anonymisé) » = CSV (séparateur « ; », UTF-8, s'ouvre dans Excel) avec noms/prénoms masqués (« C********e S*****z »), e-mail « c****@domaine.be », téléphone « 04XX/****** », numéro national « XX.XX.XX-XXX.XX » ; adresse réduite au code postal et à la commune ; parts, montants, dates d'entrée, classes et % du capital exacts. Colonne « % du capital » (parts / parts en circulation x 100, 2 décimales) dans le Registre, la fiche, les exports standard et anonymisé et la feuille de présence AG.
- Les noms de méthodes Odoo Sign / mailing sont à valider sur votre version d'Odoo ; le certificat PDF utilise la police Times (Orator Std indisponible).

## Retirer l'accès à une application (sql/10_acces_roles.sql)
Admin > Rôles : pour chaque rôle et chaque application, « Accès » (décoché = tuile masquée et pages interdites) et « Écriture » (désactivée tant que « Accès » n'est pas coché). Enregistrement automatique avec confirmation. Stocké dans `role_permissions.level` (none / read / write). Exécuter `sql/10_acces_roles.sql` : le rôle devient la seule référence (un ancien droit individuel ne rouvre plus une application retirée au rôle). Un accès direct par URL redirige vers `/dashboard` avec le message « Accès non autorisé ».

## Évolutions du 5 novembre : Coopérateurs (audit, mouvements signés) et Budget (verrou, journal, investissements)

### Ordre d'exécution dans Supabase (SQL Editor, scripts rejouables)
1. Vérifier que `02`, `04`, `05`, `06` (Budget) et `07`, `07b`, `10` (Coopérateurs / accès) ont déjà été exécutés.
2. Exécuter `sql/11_cooperateurs_audit_mouvements.sql` : signe des mouvements (le montant prend toujours le signe des parts), fonction `enregistrer_mouvement`, journal enrichi (vue `v_journal_evenements`, détection de doublons consignée), icône de la tuile.
3. Exécuter `sql/12_budget_audit_verrous_invest.sql` : `budget_modifications_log` + trigger, `budget_locks` + fonctions `budget_lock_take` / `budget_lock_release`, `budget_immobilisations`, `budget_emprunts`, `budget_journal_filtres()`.
4. Aucune nouvelle variable d'environnement. Déployer sur Vercel (`git push`, ou « Redeploy » sans cache) puis recharger les pages (Ctrl+F5).

### Coopérateurs
- **Mouvements** : « Type de mouvement » (Souscription [+] / Retrait [−]) ou saisie directe d'un nombre négatif (−2 parts = −500 €). Le solde est recalculé tout de suite ; un retrait supérieur au solde est refusé (interface et base).
- **Journal / Audit** (6e onglet) : lit la table `journal` existante (import Google Sheet, validation, mouvements, coordonnées, fusion, doublons). Filtres : type, période, coopérateur, auteur. Réservé aux administrateurs et aux utilisateurs en écriture.
- **Tuile du tableau de bord** : icône dédiée « user-check » (dessinée dans `components/AppIcon.tsx`, sans dépendance supplémentaire).

### Budget
- **Verrou d'édition** : à l'ouverture, la session prend un verrou de 3 minutes renouvelé toutes les 40 s (libéré à la fermeture ou après 10 minutes d'inactivité). Une seconde session voit « en cours d'édition par … » et passe en lecture seule ; « Prendre la main » reprend le verrou. Le contrôle `updated_at` à l'enregistrement reste le filet de sécurité, et un bandeau propose de recharger quand une version plus récente existe. Si le script 12 n'est pas exécuté, seul ce contrôle `updated_at` reste actif.
- **Investissements, Emprunts & Amortissements** : amortissement linéaire au prorata du mois de mise en service ; emprunts en annuités constantes (le taux est déduit du capital, de la mensualité et des dates). Les boutons « Injecter dans le budget » remplacent le contenu mensuel des comptes 630xxx (dotations) et 650xxx (intérêts) ; « ↶ Annuler » les rétablit. Le plan comptable du projet n'a pas de compte 630000 ni 650000 : on utilise 630200 (dotations) et 650000 (intérêts SOWECSOM) par défaut, modifiables ligne par ligne.
- **Historique / Journal** : une ligne par compte et par mois modifié (ancien, nouveau, écart, auteur) ; les modifications en masse (plus de 400 cellules) sont regroupées par compte. Filtres : budget, personne, compte, type, période.
- **Projection 3 ans** : section « Seuil de rentabilité » : charges fixes nettes / taux de marge sur coûts variables, CA d'équilibre par année, prix moyen €/HL (300 € par défaut, mémorisé dans le navigateur) et volume en HL.

## Annuaire des compétences & talents (`sql/13_cooperateurs_competences.sql`)
Trois questions ajoutées au Google Form (métier, compétences, accord de contact téléphonique) : intitulés exacts, règles de reconnaissance et marche à suivre dans `docs/GUIDE_GOOGLE_FORM_COMPETENCES.md`. Ordre : ajouter les questions au Form, exécuter `sql/13` dans Supabase, redéployer. La section « Annuaire des compétences & talents des coopérateurs » de l'onglet Statistiques ne liste que les fiches issues du formulaire avec accord « Oui » (RGPD).

## Parts offertes (cadeau / mineur) et consentement newsletter (`sql/14_cooperateurs_cadeau_rgpd.sql`)
Nouveau formulaire créé par `docs/formulaire-souscription.gs` (voir `docs/GUIDE_FORMULAIRE_SOUSCRIPTION.md` : intitulés exacts, déroulé, variables Vercel). Ordre : exécuter `sql/14` dans Supabase (après 07, 11, 13), créer le formulaire, mettre à jour `GOOGLE_SHEET_ID` si le Sheet change, redéployer. Badges 🎁 Cadeau / 👶 Mineur dans « Souscriptions & Demandes » et « Registre » ; Odoo et Brevo ne reçoivent que les contacts ayant consenti à la newsletter.

## Tests
`sql/tests/run0X_test.sql` (psql, base vide + `mock_test.sql`) vérifient les droits (RLS, validation réservée à l'admin, dernier admin protégé).
