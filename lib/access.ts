// lib/access.ts : garde d'accès côté serveur (en plus de la RLS, qui reste la vraie barrière)
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

type WriteCheck = 'can_write_budget' | 'can_write_actuals';

export async function requireApp(route: '/apps/budget' | '/apps/analyse', writeCheck: WriteCheck) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: allowed } = await supabase.rpc('has_app_access', { p_route: route });
  if (!allowed) redirect('/dashboard');

  const { data: canEdit } = await supabase.rpc(writeCheck);
  return { user, canEdit: Boolean(canEdit) };
}
