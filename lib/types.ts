// lib/types.ts : types partagés de l'application
export type Role = 'admin' | 'brasseur' | 'user';

export type Profile = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  role: Role | string;
};

export type AppRow = {
  id: string | number;
  route: string;
  name?: string | null;
  description?: string | null;
  icon?: string | null;
};

/** Applications soumises aux droits par rôle, et niveaux d'accès (sql/05_roles_permissions.sql) */
export const APP_KEYS = ['calculateur', 'budget', 'analyse', 'cooperateurs'] as const;
export type AppKey = (typeof APP_KEYS)[number];
/** Source unique des applications du portail : clé de permission, libellé, route et icône (grille des rôles dans /admin/users, garde d'accès, tuiles) */
export const APP_META: Record<AppKey, { id: AppKey; name: string; route: string; icon: string }> = {
  calculateur: { id: 'calculateur', name: 'Recette (calculateur)', route: '/apps/calculateur', icon: 'Calculator' },
  budget: { id: 'budget', name: 'Budget', route: '/apps/budget', icon: 'Wallet' },
  analyse: { id: 'analyse', name: 'Reporting (analyse)', route: '/apps/analyse', icon: 'BarChart' },
  cooperateurs: { id: 'cooperateurs', name: 'Coopérateurs', route: '/apps/cooperateurs', icon: 'Users' },
};
/** Routes protégées par requireApp() */
export type AppRoute = '/apps/budget' | '/apps/analyse' | '/apps/cooperateurs';
export const LEVELS = ['none', 'read', 'write'] as const;
export type Level = (typeof LEVELS)[number];

/** Résultat d'une action serveur de l'administration */
export type Result = { ok: boolean; message: string; link?: string };
