# Modules Budget et Analyse : mise en place

1. Supabase > SQL Editor : coller et exécuter `sql/01_budget_analyse.sql` (rejouable sans danger).
2. Vérifier que `applications.route` contient bien `/apps/budget` et `/apps/analyse`
   (sinon adapter la fonction `has_app_access` ou les routes dans `lib/access.ts`).
3. Donner l'accès via `user_app_permissions` (exemple en bas du script SQL) ; le rôle `admin` voit tout.
4. Copier `lib/` et `app/` dans le projet Next.js (en gardant vos propres `lib/supabase/client.ts` et `server.ts`
   qui exportent `createClient`). Les composants utilisent des classes Tailwind.
5. Déployer sur Vercel (push Git), puis tester avec trois comptes : admin, brasseur, utilisateur en lecture.
Écriture : rôles `admin` et `brasseur` (fonction `can_edit()` à adapter).
