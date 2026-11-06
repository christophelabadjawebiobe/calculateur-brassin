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

/** Consentement newsletter effectif d'une demande : une fois validée, c'est celui de la fiche du registre (la réponse la plus récente fait foi) ; sinon celui de la demande. */
export async function consentementNewsletter(supabase: any, d: { cooperateur_id?: number | null; valide_registre?: boolean; consentement_newsletter?: boolean | null }): Promise<boolean> {
  if (d.valide_registre && d.cooperateur_id != null) {
    const c = await supabase.from('cooperateurs').select('consentement_newsletter').eq('id', d.cooperateur_id).maybeSingle();
    if (!c.error && c.data) return Boolean(c.data.consentement_newsletter);
  }
  return Boolean(d.consentement_newsletter);
}
