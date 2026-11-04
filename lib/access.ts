// lib/access.ts : garde d'accès côté serveur (en plus de la RLS, qui reste la vraie barrière)
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { AppRoute } from '@/lib/types';

type WriteCheck = 'can_write_budget' | 'can_write_actuals' | 'can_write_cooperateurs';

/** Contrôle d'écriture par défaut de chaque application (fonctions SQL de sql/05 et sql/07) */
const WRITE_CHECK: Record<AppRoute, WriteCheck> = {
  '/apps/budget': 'can_write_budget',
  '/apps/analyse': 'can_write_actuals',
  '/apps/cooperateurs': 'can_write_cooperateurs',
};

/** Non connecté -> /login ; sans accès à l'application -> /dashboard ; renvoie aussi le droit d'écriture (writeCheck facultatif : déduit de la route) */
export async function requireApp(route: AppRoute, writeCheck: WriteCheck = WRITE_CHECK[route]) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: allowed } = await supabase.rpc('has_app_access', { p_route: route });
  if (!allowed) redirect('/dashboard');

  const { data: canEdit } = await supabase.rpc(writeCheck);
  return { user, canEdit: Boolean(canEdit) };
}
