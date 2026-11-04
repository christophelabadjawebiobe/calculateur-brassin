// lib/access.ts : garde d'accès côté serveur (en plus de la RLS, qui reste la vraie barrière)
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

type AppRoute = '/apps/budget' | '/apps/analyse' | '/apps/calculateur' | '/apps/cooperateurs';
type WriteCheck = 'can_write_budget' | 'can_write_actuals' | 'can_edit';

export async function requireApp(route: AppRoute, writeCheck?: WriteCheck) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: allowed } = await supabase.rpc('has_app_access', { p_route: route });
  if (!allowed) redirect('/dashboard');

  let canEdit = true;
  if (writeCheck) {
    const { data: check } = await supabase.rpc(writeCheck);
    canEdit = Boolean(check);
  }

  return { user, canEdit };
}
