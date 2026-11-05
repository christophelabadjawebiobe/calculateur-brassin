// lib/cooperateurs/export.ts : exports du registre (standard et anonymisé RGPD), % du capital, CSV compatible Excel
// Pur calcul : aucune dépendance au navigateur hors téléchargement (appelé uniquement sur clic, jamais au rendu serveur).
import type { Cooperateur } from './types';
import { fmtNumero, analyseNumero } from './numbers';

/** % du capital : parts du coopérateur / parts en circulation x 100, 2 décimales, virgule (« 1,00 % ») */
export function pctCapital(parts: number, total: number): string {
  if (!(total > 0) || !(parts > 0)) return '0,00 %';
  const c = Math.round((parts * 10000) / total); // centièmes de pour cent
  return Math.floor(c / 100) + ',' + String(c % 100).padStart(2, '0') + ' %';
}

// ---------- anonymisation ----------
/** Un mot : 1re lettre + astérisques + dernière lettre (« Christophe » -> « C********e »). Mots de 1 lettre inchangés, de 2 lettres : « Lu » -> « L* ». */
function masquerMot(w: string): string {
  const a = Array.from(w);
  if (a.length <= 1) return w;
  if (a.length === 2) return a[0] + '*';
  return a[0] + '*'.repeat(a.length - 2) + a[a.length - 1];
}
/** Nom, prénom, raison sociale : chaque mot masqué, séparateurs conservés (« Jean-Luc Dupont » -> « J**n-L* D****t ») */
export function anonNom(s: string | null | undefined): string {
  return String(s || '').split(/(\s+|-|'|’)/).map((p: string) => (/^(\s+|-|'|’)$/.test(p) || p === '' ? p : masquerMot(p))).join('');
}
/** E-mail : 1re lettre + 4 astérisques + domaine (« c****@domain.be ») */
export function anonEmail(s: string | null | undefined): string {
  const v = String(s || '').trim(); const i = v.lastIndexOf('@');
  if (!v) return '';
  if (i < 1) return masquerMot(v);
  return Array.from(v)[0] + '****' + v.slice(i);
}
/** Téléphone : « 04XX/****** » (2 premiers chiffres du numéro national conservés) */
export function anonTel(s: string | null | undefined): string {
  let d = String(s || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0032')) d = '0' + d.slice(4); else if (d.startsWith('32') && d.length >= 10) d = '0' + d.slice(2);
  return (d.length >= 2 ? d.slice(0, 2) : '0') + 'XX/******';
}
/** Numéro national (11 chiffres) : « XX.XX.XX-XXX.XX » ; numéro d'entreprise (10 chiffres) : « XXXX.XXX.XXX » */
export function anonNumero(s: string | null | undefined): string {
  const d = String(s || '').replace(/\D/g, '');
  if (!d) return '';
  return d.length === 10 ? 'XXXX.XXX.XXX' : 'XX.XX.XX-XXX.XX';
}

// ---------- lignes d'export ----------
export type ExportOpts = { anonyme: boolean; date?: string; total?: number };
const parts = (c: Cooperateur, date?: string): number => (c.mouvements_parts || []).filter((m) => !date || !m.date_mouvement || m.date_mouvement <= date).reduce((s: number, m) => s + m.nombre_parts, 0);
const contact = (c: Cooperateur, t: 'email' | 'telephone'): string => { const l = (c.contacts || []).filter((x) => x.type === t).sort((a, b) => Number(b.principal) - Number(a.principal) || a.id - b.id); return l.length ? l[0].valeur : ''; };
const adr = (c: Cooperateur) => (c.adresses || []).slice().sort((a, b) => Number(b.type === 'principale') - Number(a.type === 'principale') || a.id - b.id)[0] || null;
const premiereDate = (c: Cooperateur): string => { const d = (c.mouvements_parts || []).filter((m) => m.nombre_parts > 0 && m.date_mouvement).map((m) => m.date_mouvement as string).sort(); return d.length ? d[0] : ''; };
const isoFr = (d: string): string => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

export const ENTETES_REGISTRE = ['N° certificat', 'Nom', 'Prénom', 'Représentant', 'Classe', 'N° national / entreprise', 'E-mail', 'Téléphone', 'Code postal', 'Commune', 'Date d’entrée', 'Parts', 'Capital (€)', '% du capital'];
export const ENTETES_REGISTRE_STANDARD = ['N° certificat', 'Nom', 'Prénom', 'Représentant', 'Classe', 'N° national / entreprise', 'E-mail', 'Téléphone', 'Rue', 'N°', 'Code postal', 'Commune', 'Pays', 'Date d’entrée', 'Parts', 'Capital (€)', '% du capital'];

/** Lignes du registre (une par coopérateur ayant au moins un mouvement). Données de parts, montants, dates et classes toujours exactes. */
export function lignesRegistre(coops: Cooperateur[], valeurPart: number, o: ExportOpts): { entetes: string[]; lignes: (string | number)[][] } {
  const tot = o.total != null ? o.total : coops.reduce((s: number, c: Cooperateur) => s + Math.max(0, parts(c, o.date)), 0);
  const base = coops.map((c: Cooperateur) => ({ c, p: parts(c, o.date) })).sort((a, b) => (a.c.certificat ?? 1e9) - (b.c.certificat ?? 1e9) || a.c.nom.localeCompare(b.c.nom, 'fr'));
  const lignes = base.map(({ c, p }) => {
    const a = adr(c); const cl = c.categories ? c.categories.code : '';
    if (o.anonyme) return [c.certificat ?? '', anonNom(c.nom), anonNom(c.prenom), anonNom(c.representant), cl, anonNumero(c.numero_identification), anonEmail(contact(c, 'email')), anonTel(contact(c, 'telephone')),
      a && a.code_postal ? a.code_postal : '', a && a.ville ? a.ville : '', isoFr(premiereDate(c)), p, p * valeurPart, pctCapital(p, tot)];
    const num = analyseNumero(c.numero_identification).digits;
    return [c.certificat ?? '', c.nom, c.prenom || '', c.representant || '', cl, num ? fmtNumero(num) : '', contact(c, 'email'), contact(c, 'telephone'),
      a && a.rue ? a.rue : '', a && a.numero ? a.numero : '', a && a.code_postal ? a.code_postal : '', a && a.ville ? a.ville : '', a && a.pays ? a.pays : '', isoFr(premiereDate(c)), p, p * valeurPart, pctCapital(p, tot)];
  });
  return { entetes: o.anonyme ? ENTETES_REGISTRE : ENTETES_REGISTRE_STANDARD, lignes };
}

// ---------- CSV (séparateur « ; », UTF-8 avec BOM : s'ouvre directement dans Excel) ----------
const cell = (v: unknown): string => { let s = String(v == null ? '' : v); if (/^[=@\t]/.test(s)) s = "'" + s; return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export const versCsv = (entetes: string[], lignes: (string | number)[][]): string => [entetes, ...lignes].map((r) => r.map(cell).join(';')).join('\r\n');
export function telechargerCsv(nom: string, contenu: string): void {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + contenu], { type: 'text/csv;charset=utf-8' })); a.download = nom;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
