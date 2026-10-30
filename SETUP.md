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
5. Donner l'accès via `user_app_permissions` ; le rôle `admin` voit tout.
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

## Tests
`sql/tests/run0X_test.sql` (psql, base vide + `mock_test.sql`) vérifient les droits (RLS, validation réservée à l'admin, dernier admin protégé).
