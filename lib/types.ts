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
