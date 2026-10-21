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
3. Supabase > SQL Editor : exécuter `sql/01_budget_analyse.sql` (rejouable).
4. `applications.route` doit valoir `/apps/budget`, `/apps/analyse`, `/apps/calculateur`.
   Le tableau de bord lit les colonnes `name` (ou `title`/`label`), `description` et `icon` si elles existent.
5. Donner l'accès via `user_app_permissions` ; le rôle `admin` voit tout.
6. `git push` : Vercel déploie. Tester avec admin, brasseur et utilisateur en lecture.

Écriture : rôles `admin` et `brasseur` (fonction `can_edit()` à adapter).
