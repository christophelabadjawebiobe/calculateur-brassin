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
export const APP_KEYS = ['calculateur', 'budget', 'analyse'] as const;
export type AppKey = (typeof APP_KEYS)[number];
export const LEVELS = ['none', 'read', 'write'] as const;
export type Level = (typeof LEVELS)[number];

/** Résultat d'une action serveur de l'administration */
export type Result = { ok: boolean; message: string; link?: string };
