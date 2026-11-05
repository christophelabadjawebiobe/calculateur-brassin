// lib/invest.ts : calculs des amortissements (linéaire, prorata temporis au mois) et des emprunts (annuités constantes)
// Fonctions pures, sans accès au navigateur ni à la base : les mois sont indexés 0 (janvier) à 11 (décembre).

export type Immo = {
  id: string; libelle: string; date_service: string; duree_annees: number; montant_htva: number;
  methode: 'lineaire'; statut: 'existant' | 'simulation'; inclus: boolean; compte: string; commentaire?: string | null;
};
export type Emprunt = {
  id: string; organisme: string; capital: number; mensualite: number; date_premiere_echeance: string; date_fin: string;
  compte_interets: string; commentaire?: string | null;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** « 2026-03-15 » -> index de mois absolu (année × 12 + mois 0-11) ; NaN si la date est invalide */
export function moisAbsolu(iso: string): number {
  const m = /^(\d{4})-(\d{2})/.exec(iso || '');
  if (!m) return NaN;
  const mo = +m[2];
  return mo >= 1 && mo <= 12 ? +m[1] * 12 + (mo - 1) : NaN;
}

/* ------------------------------ amortissements ------------------------------ */

/** nombre total de mensualités d'amortissement */
export const nbMoisAmort = (i: Pick<Immo, 'duree_annees'>): number => Math.max(1, Math.round(i.duree_annees * 12));
/** annuité pleine (montant / durée en années) */
export const annuite = (i: Pick<Immo, 'montant_htva' | 'duree_annees'>): number => (i.duree_annees > 0 ? r2(i.montant_htva / i.duree_annees) : 0);

/** dotation de chaque mois de l'année ; l'amortissement commence le mois de mise en service (prorata temporis au mois) */
export function dotationsMois(i: Immo, year: number): number[] {
  const out: number[] = Array(12).fill(0);
  const s = moisAbsolu(i.date_service); if (!Number.isFinite(s) || !(i.montant_htva > 0)) return out;
  const n = nbMoisAmort(i), mensuel = i.montant_htva / n;
  for (let m = 0; m < 12; m++) { const t = year * 12 + m; if (t >= s && t < s + n) out[m] = mensuel; }
  return out;
}
export const dotationAnnee = (i: Immo, year: number): number => r2(dotationsMois(i, year).reduce((a, b) => a + b, 0));
/** valeur nette comptable au 31 décembre de l'année */
export function vncFin(i: Immo, year: number): number {
  const s = moisAbsolu(i.date_service); if (!Number.isFinite(s)) return r2(i.montant_htva);
  const n = nbMoisAmort(i), fin = year * 12 + 11;
  const ecoules = Math.max(0, Math.min(n, fin - s + 1));
  return r2(i.montant_htva * (1 - ecoules / n));
}
/** prorata de la première année : mois amortis / 12 */
export function moisPremiereAnnee(i: Immo): number {
  const s = moisAbsolu(i.date_service); if (!Number.isFinite(s)) return 0;
  return Math.min(nbMoisAmort(i), 12 - (s % 12));
}

/* --------------------------------- emprunts --------------------------------- */

export type EmpruntCalc = {
  n: number;                 // nombre de mensualités
  tauxMensuel: number;       // taux implicite (déduit du capital, de la mensualité et de la durée)
  tauxAnnuel: number;        // ≈ taux mensuel × 12
  insuffisant: boolean;      // la mensualité × n ne rembourse pas le capital
  mois: { t: number; interets: number; principal: number; solde: number }[];   // t = index de mois absolu
};

/** taux mensuel r tel que capital = mensualité × (1 − (1+r)^−n) / r (dichotomie) ; 0 si le total remboursé ne dépasse pas le capital */
export function tauxImplicite(capital: number, mensualite: number, n: number): number {
  if (!(capital > 0) || !(mensualite > 0) || n < 1) return 0;
  if (mensualite * n <= capital + 0.005) return 0;
  const val = (r: number) => (r < 1e-12 ? mensualite * n : (mensualite * (1 - Math.pow(1 + r, -n))) / r);
  let lo = 0, hi = 1;
  for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (val(mid) > capital) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

export function echeancier(e: Emprunt): EmpruntCalc {
  const a = moisAbsolu(e.date_premiere_echeance), b = moisAbsolu(e.date_fin);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return { n: 0, tauxMensuel: 0, tauxAnnuel: 0, insuffisant: false, mois: [] };
  const n = b - a + 1, r = tauxImplicite(e.capital, e.mensualite, n);
  const mois: EmpruntCalc['mois'] = [];
  let solde = e.capital;
  for (let k = 0; k < n; k++) {
    const interets = solde * r;
    let principal = Math.min(e.mensualite - interets, solde);
    if (k === n - 1 && r > 0) principal = solde;          // la dernière échéance solde exactement le capital
    if (principal < 0) principal = 0;
    solde = solde - principal;
    mois.push({ t: a + k, interets, principal, solde });
  }
  return { n, tauxMensuel: r, tauxAnnuel: r * 12, insuffisant: e.mensualite * n < e.capital - 0.005, mois };
}

export type EmpruntAnnee = { interets: number[]; principal: number[]; totalInterets: number; totalPrincipal: number; soldeDebut: number; soldeFin: number };
export function empruntAnnee(e: Emprunt, c: EmpruntCalc, year: number): EmpruntAnnee {
  const interets: number[] = Array(12).fill(0), principal: number[] = Array(12).fill(0);
  let soldeFin = 0, soldeDebut = 0;
  const a = moisAbsolu(e.date_premiere_echeance);
  if (!c.mois.length) return { interets, principal, totalInterets: 0, totalPrincipal: 0, soldeDebut: 0, soldeFin: 0 };
  const d0 = year * 12, d1 = year * 12 + 11;
  soldeDebut = d0 <= a ? e.capital : (c.mois.filter((x) => x.t < d0).slice(-1)[0] || { solde: e.capital }).solde;
  soldeFin = d1 < a ? e.capital : (c.mois.filter((x) => x.t <= d1).slice(-1)[0] || { solde: e.capital }).solde;
  c.mois.forEach((x) => { if (x.t >= d0 && x.t <= d1) { interets[x.t - d0] = x.interets; principal[x.t - d0] = x.principal; } });
  const sum = (v: number[]) => v.reduce((p, q) => p + q, 0);
  return { interets, principal, totalInterets: r2(sum(interets)), totalPrincipal: r2(sum(principal)), soldeDebut: r2(soldeDebut), soldeFin: r2(soldeFin) };
}

/* ------------------------ totaux par année (pour l'injection) ------------------------ */

/** dotations mensuelles à injecter dans un compte (immobilisations incluses uniquement, tous statuts confondus) */
export function dotationsParCompte(immos: Immo[], year: number): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  immos.filter((i) => i.inclus).forEach((i) => {
    const t = (out[i.compte] = out[i.compte] || Array(12).fill(0));
    dotationsMois(i, year).forEach((v, m) => { t[m] += v; });
  });
  Object.keys(out).forEach((k) => { out[k] = out[k].map(r2); });
  return out;
}
/** intérêts mensuels à injecter par compte d'intérêts */
export function interetsParCompte(emprunts: Emprunt[], year: number): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  emprunts.forEach((e) => {
    const c = echeancier(e), y = empruntAnnee(e, c, year);
    const t = (out[e.compte_interets] = out[e.compte_interets] || Array(12).fill(0));
    y.interets.forEach((v, m) => { t[m] += v; });
  });
  Object.keys(out).forEach((k) => { out[k] = out[k].map(r2); });
  return out;
}
