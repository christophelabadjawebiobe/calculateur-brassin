// app/apps/cooperateurs/data.ts : chargement (Supabase, côté client) et calculs dérivés du module Coopérateurs
import type { Categorie, Cooperateur, Demande, Valorisation } from '@/lib/cooperateurs/types';

export type Store = { categories: Categorie[]; coops: Cooperateur[]; demandes: Demande[]; valos: Valorisation[]; valeurPart: number; prefixe: string; isAdmin: boolean; canWrite: boolean; demo?: boolean };

async function fetchAll(q: (from: number, to: number) => any): Promise<{ data: any[]; error: any }> {
  const out: any[] = [];
  for (let i = 0; i < 100; i++) {
    const r = await q(i * 1000, i * 1000 + 999);
    if (r.error) return { data: out, error: r.error };
    out.push(...(r.data || []));
    if (!r.data || r.data.length < 1000) break;
  }
  return { data: out, error: null };
}

export async function chargerTout(supabase: any, canEditServer: boolean): Promise<{ store: Store | null; erreur: string }> {
  const [cat, par, coops, dem, val, adm, w] = await Promise.all([
    supabase.from('categories').select('*').order('code'),
    supabase.from('parametres').select('cle,valeur'),
    fetchAll((a, b) => supabase.from('cooperateurs').select('*, categories(code,libelle), adresses(*), contacts(*), mouvements_parts(*)').order('id').range(a, b)),
    fetchAll((a, b) => supabase.from('cooperateur_demandes').select('*').order('date_demande', { ascending: false }).range(a, b)),
    supabase.from('valorisations_annuelles').select('*').order('date_cloture', { ascending: false }),
    supabase.rpc('is_admin'), supabase.rpc('can_write_cooperateurs'),
  ]);
  const err = cat.error || par.error || coops.error || dem.error || val.error;
  if (err) {
    const m: string = err.message || '';
    return { store: null, erreur: /relation|does not exist|schema cache/i.test(m) ? 'Les tables du module n’existent pas encore : exécutez sql/07_cooperateurs.sql dans Supabase (SQL Editor), puis rechargez la page.' : 'Chargement impossible : ' + m };
  }
  const P: Record<string, string> = {}; (par.data || []).forEach((r: any) => { P[r.cle] = r.valeur; });
  return { erreur: '', store: {
    categories: cat.data || [], coops: coops.data as Cooperateur[], demandes: dem.data as Demande[], valos: (val.data || []) as Valorisation[],
    valeurPart: Number(P.valeur_part) || 250, prefixe: P.prefixe_reference || 'LDF', isAdmin: Boolean(adm.data), canWrite: Boolean(w.data) && canEditServer,
  } };
}

export const partsDe = (c: Cooperateur): number => (c.mouvements_parts || []).reduce((s: number, m) => s + m.nombre_parts, 0);
export const emailDe = (c: Cooperateur): string => { const l = (c.contacts || []).filter((x) => x.type === 'email').sort((a, b) => Number(b.principal) - Number(a.principal) || a.id - b.id); return l.length ? l[0].valeur : ''; };
export const telDe = (c: Cooperateur): string => { const l = (c.contacts || []).filter((x) => x.type === 'telephone').sort((a, b) => Number(b.principal) - Number(a.principal) || a.id - b.id); return l.length ? l[0].valeur : ''; };
export const adresseDe = (c: Cooperateur) => (c.adresses || []).slice().sort((a, b) => Number(b.type === 'principale') - Number(a.type === 'principale') || a.id - b.id)[0] || null;
export const villeDe = (c: Cooperateur): string => { const a = adresseDe(c); return a && a.ville ? a.ville : ''; };
export const nomComplet = (c: { nom: string; prenom?: string | null; representant?: string | null }): string => [c.nom, c.prenom].filter(Boolean).join(' ') + (!c.prenom && c.representant ? ` (rep. ${c.representant})` : '');
export const prochainCertificat = (coops: Cooperateur[]): number => coops.reduce((m: number, c: Cooperateur) => Math.max(m, c.certificat || 0), 0) + 1;

export async function appelApi(path: string, body?: unknown): Promise<any> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), credentials: 'same-origin' });
    const j = await r.json().catch(() => ({ ok: false, message: 'Réponse invalide (HTTP ' + r.status + ')' }));
    return j;
  } catch (e: any) { return { ok: false, message: 'Réseau indisponible : ' + (e && e.message ? e.message : e) }; }
}
