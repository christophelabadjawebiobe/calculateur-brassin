// lib/cooperateurs/numbers.ts : numéros nationaux (11 chiffres) et d'entreprise / BCE (10 chiffres) belges, référence bancaire, formats
// Fonctions pures, sans dépendance au navigateur ni à Intl : le rendu est identique côté serveur et côté client (pas d'erreur d'hydratation).

export const digits = (s: unknown): string => String(s == null ? '' : s).replace(/\D/g, '');

/** clé de contrôle d'un numéro national (personnes nées avant ou après 2000) */
export function okRN(d: string): boolean {
  if (d.length !== 11) return false;
  const b = parseInt(d.slice(0, 9), 10), c = parseInt(d.slice(9), 10);
  return 97 - (b % 97) === c || 97 - ((2000000000 + b) % 97) === c;
}
/** clé de contrôle d'un numéro d'entreprise (BCE) : 97 − (8 premiers chiffres modulo 97) */
export function okBCE(d: string): boolean {
  if (d.length !== 10) return false;
  return 97 - (parseInt(d.slice(0, 8), 10) % 97) === parseInt(d.slice(8), 10);
}

export type NumeroInfo = { digits: string; kind: 'rn' | 'bce' | null; valide: boolean | null; format: string };
/** Nettoie un numéro saisi librement (points, tirets, « BE », espaces) et contrôle sa clé (modulo 97). 9 chiffres : zéro initial ajouté (BCE). */
export function analyseNumero(raw: unknown): NumeroInfo {
  let d = digits(raw);
  if (!d) return { digits: '', kind: null, valide: null, format: '' };
  if (d.length === 9) d = '0' + d;
  if (d.length === 11) return { digits: d, kind: 'rn', valide: okRN(d), format: fmtNumero(d) };
  if (d.length === 10) return { digits: d, kind: 'bce', valide: okBCE(d), format: fmtNumero(d) };
  return { digits: d, kind: null, valide: false, format: d };
}
export function fmtNumero(d: string): string {
  if (d.length === 11) return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4, 6)}-${d.slice(6, 9)}.${d.slice(9)}`;
  if (d.length === 10) return `BE ${d.slice(0, 4)}.${d.slice(4, 7)}.${d.slice(7)}`;
  return d;
}

const minusc = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w);
/** « jean-pierre d'arc » → « Jean-Pierre D'Arc » */
export const titleCase = (s: string): string => String(s || '').trim().replace(/\s+/g, ' ').split(' ').map((w: string) => w.split(/([-'’])/).map(minusc).join('')).join(' ');

/** Référence de virement courte : « LDF2026 : NOM Prénom » (année de la demande) */
export function referenceBancaire(nom: string, prenom: string | null | undefined, annee: number, prefixe = 'LDF'): string {
  const n = String(nom || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const p = prenom ? titleCase(prenom) : '';
  return (`${prefixe}${annee} : ${n}${p ? ' ' + p : ''}`).slice(0, 140);
}

/* ---------- formats d'affichage (sans toLocaleString) ---------- */
export const groupDigits = (n: number): string => String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const fmtNombre = (n: number): string => (n < 0 ? '−' : '') + groupDigits(n);
export function fmtMontant(n: number, dec = 0): string {
  const c = Math.round(Math.abs(n) * (dec ? 100 : 1));
  const ent = dec ? Math.floor(c / 100) : c;
  return (n < 0 && c > 0 ? '−' : '') + groupDigits(ent) + (dec ? ',' + String(c % 100).padStart(2, '0') : '') + ' €';
}
/** AAAA-MM-JJ[...] → J/M/AAAA */
export function fmtDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${+m[3]}/${+m[2]}/${m[1]}` : '';
}
/** AAAA-MM-JJ[...] → JJ/MM/AAAA */
export function fmtDateLong(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
export function fmtDateHeure(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : fmtDate(iso);
}
