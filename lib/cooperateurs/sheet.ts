// lib/cooperateurs/sheet.ts : lecture et nettoyage des réponses du Google Form (Google Sheet ou CSV)
// - correspondance tolérante des en-têtes (le libellé exact des questions du formulaire n'a pas besoin d'être identique)
// - nettoyage des numéros nationaux / d'entreprise (modulo 97), type de souscripteur, classe, référence bancaire « LDF2026 : NOM Prénom »
import { analyseNumero, digits, referenceBancaire, titleCase } from './numbers';

export type ImportRow = {
  google_row_id: string; date_demande: string | null; nom: string; prenom: string | null; representant: string | null; email: string | null; telephone: string | null;
  rue: string | null; numero: string | null; code_postal: string | null; ville: string | null; pays: string; numero_national: string | null; numero_valide: boolean | null;
  reference_bancaire: string; type_souscripteur: 'personne_physique' | 'entreprise'; categorie_code: 'B' | 'C' | 'D'; nombre_parts: number; donnees_brutes: Record<string, string>;
};

const norm = (s: string): string => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Champs reconnus, du plus spécifique au plus général (un en-tête n'est attribué qu'une fois) */
const FIELDS: [string, RegExp][] = [
  ['date', /horodateur|timestamp|date de (la )?(demande|souscription|reponse)|^date$/],
  ['email', /e ?mail|courriel|adresse mail|^mail$/],
  ['telephone', /telephone|gsm|mobile|^tel$|^tel /],
  ['code_postal', /code postal|^cp$/],
  ['ville', /ville|commune|localite/],
  ['pays', /^pays/],
  ['numero_national', /national|registre|rrn|niss|bce|entreprise|tva|identification|numero d identite/],
  ['prenom', /prenom|first ?name/],
  ['representant', /representant|personne de contact|mandataire/],
  ['nombre_parts', /nombre de parts|combien|parts/],
  ['categorie', /categorie|classe/],
  ['type', /type|en tant que|qualite|personne physique|statut/],
  ['numero_rue', /^(n|no|num|numero)( de)?( la)?( rue| maison| boite)?$|numero de rue|^boite/],
  ['rue', /^rue|adresse|voie/],
  ['nom', /(^| )nom( |$)|denomination|raison sociale|societe|last ?name/],
];

export function mapHeaders(headers: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  headers.forEach((h: string, i: number) => {
    const n = norm(h); if (!n) return;
    for (const [f, re] of FIELDS) if (!(f in out) && re.test(n)) { out[f] = i; return; }
  });
  return out;
}

/** CSV (virgule, point-virgule ou tabulation ; guillemets et retours à la ligne dans les cellules) */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/)[0] || '';
  const delim = [';', '\t', ','].map((d: string) => [d, first.split(d).length] as [string, number]).sort((a: [string, number], b: [string, number]) => b[1] - a[1])[0][0];
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x: string) => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x: string) => x.trim())) rows.push(row);
  return rows;
}

/** FNV-1a 32 bits : identifiant stable (même ligne = même identifiant, même si les lignes du Sheet sont triées ou supprimées) */
function hash(s: string): string { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }

/** Date du formulaire : ISO, « 31/10/2026 14:05:12 » (Google Sheets, jour d'abord) ou « 10/31/2026 » (impossible : jour > 12 détecté) */
export function parseDateForm(s: string): string | null {
  const v = (s || '').trim(); if (!v) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] || '12'}:${m[5] || '00'}:${m[6] || '00'}`;
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  if (!m) return null;
  let d = +m[1], mo = +m[2]; if (mo > 12 && d <= 12) { const x = d; d = mo; mo = x; }
  const p = (n: number) => String(n).padStart(2, '0');
  return `${m[3]}-${p(mo)}-${p(d)}T${p(+(m[4] || 12))}:${m[5] || '00'}:${m[6] || '00'}`;
}

// Classes (statuts) : B = personne physique, C = institutionnel, D = entreprise (personnes morales, sociétés, ASBL). A = garant (fondateur), jamais issu du formulaire.
const reInstitution = /institution|commune|cpas|public|pouvoir|fonds|fondation|region|province|ville de|intercommunale|universite|haute ecole|invest/;
const reEntreprise = /entreprise|societe|asbl|association|morale|organisation|srl|sa\b|scrl|sprl|snc|cvba|nv\b|bv\b|independant/;

/** Transforme un tableau (ligne d'en-têtes + lignes) en lignes prêtes pour importer_demandes() */
export function cleanRows(table: string[][], opts: { prefixe?: string; anneeDefaut?: number } = {}): { rows: ImportRow[]; ignorees: number } {
  if (table.length < 2) return { rows: [], ignorees: 0 };
  const headers = table[0], map = mapHeaders(headers);
  const get = (r: string[], f: string): string => (f in map ? String(r[map[f]] ?? '').trim() : '');
  const rows: ImportRow[] = []; let ignorees = 0;
  for (const r of table.slice(1)) {
    const brut: Record<string, string> = {}; headers.forEach((h: string, i: number) => { if (h) brut[h] = String(r[i] ?? ''); });
    let nom = get(r, 'nom'), prenom = get(r, 'prenom'); const email = get(r, 'email').toLowerCase();
    if (!nom && !prenom && !email) { ignorees++; continue; }
    if (!nom && prenom) { nom = prenom; prenom = ''; }
    const num = analyseNumero(get(r, 'numero_national'));
    const typeTxt = norm(get(r, 'type') + ' ' + get(r, 'categorie'));
    let entreprise = (reEntreprise.test(typeTxt) || reInstitution.test(typeTxt)) && !/personne physique/.test(typeTxt);
    if (!typeTxt.trim()) entreprise = num.kind === 'bce' || (!prenom && !!get(r, 'representant'));
    let cat: 'B' | 'C' | 'D' = entreprise ? (reInstitution.test(typeTxt) ? 'C' : 'D') : 'B';
    const lettre = /\b([bcd])\b/.exec(norm(get(r, 'categorie')));
    if (lettre) cat = lettre[1].toUpperCase() as 'B' | 'C' | 'D';
    if (cat !== 'B') entreprise = true;
    let rue = get(r, 'rue'), numero = get(r, 'numero_rue');
    if (rue && !numero) { const m = /^(.*?)[,\s]+(\d+\s*[a-zA-Z]?(?:\s*(?:bte|boite|b)\s*\S+)?)$/.exec(rue); if (m) { rue = m[1].trim(); numero = m[2].trim(); } }
    const date = parseDateForm(get(r, 'date'));
    const annee = date ? +date.slice(0, 4) : opts.anneeDefaut || 2026;
    const parts = Math.max(1, parseInt(digits(get(r, 'nombre_parts')) || '1', 10) || 1);
    const nomNet = entreprise ? nom.trim().toUpperCase() : nom.trim();
    rows.push({
      google_row_id: 'gs-' + hash([date || '', email, norm(nom), norm(prenom)].join('|')),
      date_demande: date, nom: nomNet, prenom: prenom ? titleCase(prenom) : null, representant: get(r, 'representant') ? titleCase(get(r, 'representant')) : null,
      email: email || null, telephone: get(r, 'telephone') || null, rue: rue || null, numero: numero || null, code_postal: digits(get(r, 'code_postal')) || null,
      ville: get(r, 'ville') ? titleCase(get(r, 'ville')) : null, pays: get(r, 'pays') ? titleCase(get(r, 'pays')) : 'Belgique',
      numero_national: num.digits || null, numero_valide: num.valide, reference_bancaire: referenceBancaire(nomNet, entreprise ? null : prenom, annee, opts.prefixe || 'LDF'),
      type_souscripteur: entreprise ? 'entreprise' : 'personne_physique', categorie_code: cat, nombre_parts: parts, donnees_brutes: brut,
    });
  }
  return { rows, ignorees };
}

/** Lignes d'exemple du mode simulation (GOOGLE_SHEET_ID absent) : en-têtes d'un formulaire type */
export const SIM_TABLE: string[][] = [
  ['Horodateur', 'Nom', 'Prénom', 'Adresse e-mail', 'Téléphone', 'Rue', 'Numéro', 'Code postal', 'Localité', 'Pays', 'Numéro national', 'Vous souscrivez en tant que', 'Nombre de parts'],
  ['01/11/2026 09:12:00', 'Demo', 'Alice', 'alice.demo@example.org', '0470 11 22 33', 'Rue du Test', '12', '4000', 'liège', 'Belgique', '85.07.30-033.28', 'Personne physique', '2'],
  ['02/11/2026 18:40:10', 'Démo Brasserie SRL', '', 'contact@demo-brasserie.example', '04 222 33 44', 'Avenue de la Bière 3', '', '4020', 'Liège', 'Belgique', '0123.456.749', 'Entreprise', '10'],
  ['03/11/2026 08:05:44', 'Exemple', 'Bernard', 'bernard.exemple@example.org', '', 'Rue Fictive 7', '', '4430', 'Ans', '', '', 'Personne physique', '1'],
];
