// app/apps/analyse/compute.ts : calculs purs de l'analyse (testables hors navigateur)
import { ACC_SEC, CHART, Z12, accMonths, addTo, results, secAccKeys, sum, type Entry, type Plan, type Sec } from '@/lib/pcmn';

export type Accts = Record<string, number[]>;
export type Actuals = Record<number, Accts>; // année -> compte -> 12 mois

/** Séries par section (12 mois) à partir des montants par compte */
export function sectionsFrom(accts: Accts): Record<string, number[]> {
  const S: Record<string, number[]> = {};
  CHART.forEach((s) => { S[s.k] = Z12(); });
  Object.entries(accts).forEach(([k, m]) => { const s = ACC_SEC[k]; if (s) addTo(S[s.k], m); });
  return S;
}
/** Indicateur (section du plan comptable ou résultat calculé) en 12 mois */
export function metric(accts: Accts, id: string): number[] {
  const S = sectionsFrom(accts);
  return S[id] ? S[id] : (results(S, 12)[id] || Z12());
}
/** Même chose pour des totaux annuels par compte (1 valeur) */
export function metricAnnual(totals: Record<string, number>, id: string): number {
  const S: Record<string, number[]> = {};
  CHART.forEach((s) => { S[s.k] = [0]; });
  Object.entries(totals).forEach(([k, v]) => { const s = ACC_SEC[k]; if (s) S[s.k][0] += v; });
  return S[id] ? S[id][0] : (results(S, 1)[id] || [0])[0];
}
export const planAccts = (plan: Plan | null | undefined): Accts => {
  const o: Accts = {};
  if (plan && plan.rows) Object.keys(plan.rows).forEach((k) => { o[k] = accMonths(plan.rows[k] as Entry); });
  return o;
};
/** Nombre de mois réalisés (1 à 12) : dernier mois pour lequel des chiffres existent ; 0 si aucun */
export function realizedMonths(a: Accts | undefined, rawMonths?: Set<number>): number {
  if (rawMonths && rawMonths.size) return Math.max(...rawMonths);
  if (!a) return 0;
  let last = 0; Object.values(a).forEach((m) => m.forEach((v, i) => { if (Math.abs(v) >= 0.005) last = Math.max(last, i + 1); })); return last;
}
/** true si un indicateur est « meilleur quand il est plus haut » (produits, marges, résultats) */
export const higherIsBetter = (id: string) => { const s = CHART.find((x) => x.k === id); return !s || s.kind !== 'cost'; };
export const sectionOf = (id: string): Sec | undefined => CHART.find((s) => s.k === id);
export const detailKeys = (id: string): string[] => { const s = sectionOf(id); return s ? secAccKeys(s) : []; };

export type Period = { label: string; months: number[]; kind: 'm' | 'q' | 't' };
export function periods(gran: 'month' | 'quarter' | 'year', showQ: boolean, monthNames: string[], year: number): Period[] {
  if (gran === 'year') return [{ label: String(year), months: Array.from({ length: 12 }, (_, i) => i), kind: 't' }];
  if (gran === 'quarter') return [0, 1, 2, 3].map((q) => ({ label: 'T' + (q + 1), months: [q * 3, q * 3 + 1, q * 3 + 2], kind: 'q' as const }));
  const out: Period[] = [];
  for (let q = 0; q < 4; q++) { for (let j = 0; j < 3; j++) out.push({ label: monthNames[q * 3 + j], months: [q * 3 + j], kind: 'm' }); if (showQ) out.push({ label: 'T' + (q + 1), months: [q * 3, q * 3 + 1, q * 3 + 2], kind: 'q' }); }
  return out;
}

export type Agg = { real: number | null; budget: number | null; budCmp: number | null; n1: number | null; n1Cmp: number | null; done: number; total: number };
/** Agrège une période : réalisé sur les mois écoulés ; budget et N-1 sur la période entière et sur les seuls mois réalisés (comparaison à périmètre égal) */
export function aggregate(months: number[], last: number, real: number[] | null, bud: number[] | null, n1: number[] | null, n1Annual: number | null): Agg {
  const doneM = months.filter((m) => m < last);
  const s = (a: number[], ms: number[]) => ms.reduce((x, m) => x + (a[m] || 0), 0);
  const full = months.length === 12;
  return {
    real: real && doneM.length ? s(real, doneM) : null,
    budget: bud ? s(bud, months) : null,
    budCmp: bud && doneM.length ? s(bud, doneM) : null,
    n1: n1 ? s(n1, months) : full && n1Annual != null ? n1Annual : null,
    n1Cmp: n1 && doneM.length ? s(n1, doneM) : full && n1Annual != null && doneM.length === 12 ? n1Annual : null,
    done: doneM.length, total: months.length,
  };
}
export const cumulative = (v: (number | null)[]): (number | null)[] => { let t = 0; return v.map((x) => (x == null ? null : (t += x))); };
export { sum };
