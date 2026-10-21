# Projet Next.js (App Router) + Supabase : mise en place

Arborescence (à la racine du dépôt) :

    app/layout.tsx  app/page.tsx  app/globals.css
    app/login/page.tsx  app/dashboard/page.tsx
    app/apps/{budget,analyse,calculateur}/…
    lib/finance.ts  lib/access.ts  lib/supabase/{client,server}.ts
    middleware.ts  tsconfig.json  package.json  tailwind.config.ts  postcss.config.mjs

1. Copier le contenu du ZIP à la racine du projet (`middleware.ts` à côté de `package.json`, PAS dans `app/`),
   puis `npm install`.
2. Variables d'environnement (Vercel > Settings > Environment Variables, et `.env.local` en local) :
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (voir `.env.example`). Redéployer après ajout.
3. Supabase > SQL Editor : exécuter, dans l'ordre (tous rejouables) :
   - `sql/01_budget_analyse.sql` : droits (`is_admin`, `can_edit`, `has_app_access`…) et ancien module Budget/Analyse ;
   - `sql/02_budget_pcmn.sql` : module Budget PCMN (tables `pcmn_budget_plans` et `pcmn_budget_history`,
     réalisé 2023-2025 et budget 2026 de départ tirés de « creation budjet.xlsx ») ;
   - `sql/03_app_state_calculateur.sql` : base partagée du Calculateur (`app_state`), droits lus dans `profiles`.
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
Plan comptable PCMN du fichier Excel ; année 2026 par mois + T1 à T4 + total ; historique 2023-2025 repliable ; saisie mensuelle ou annuelle ;
variation en % ; sous-lignes de détail (classes 70 et 62 avec préréglages, mais disponibles sur tous les comptes) ;
KPI en temps réel. Le budget est enregistré dans `pcmn_budget_plans` (un document JSON par année). Pour une autre année, changer `YEAR` en tête de fichier.
Remarque : l'ancien module (tables `budget_lines`…) reste en base pour la page Analyse, qui n'a pas été reliée au nouveau budget.
