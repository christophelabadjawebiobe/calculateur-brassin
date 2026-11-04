// lib/cooperateurs/guard.ts : garde d'accès des routes API du module (session Supabase + droits sur l'application « cooperateurs »)
import { createClient } from '@/lib/supabase/server';

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export async function garde(write: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { err: json({ ok: false, message: 'Non connecté' }, 401) };
  const acc = await supabase.rpc('has_app_access', { p_route: '/apps/cooperateurs' });
  if (acc.error || !acc.data) return { err: json({ ok: false, message: 'Accès refusé' }, 403) };
  if (write) {
    const w = await supabase.rpc('can_write_cooperateurs');
    if (w.error || !w.data) return { err: json({ ok: false, message: 'Droits insuffisants (écriture requise)' }, 403) };
  }
  return { supabase, user };
}
export const messageErreur = (e: any): string => (e && e.message ? String(e.message) : 'Erreur inattendue');
