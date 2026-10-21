// lib/finance.ts : types et utilitaires communs aux modules Budget et Analyse
export const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'] as const;
export const MONTHS_LONG = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'] as const;

export type CategoryCode =
  | 'ventes' | 'autres_revenus' | 'matieres_premieres' | 'charges_variables' | 'personnel' | 'charges_fixes';
export type Kind = 'revenu' | 'cout';

// Doit rester aligné avec la table public.finance_categories
export const CATEGORIES: { code: CategoryCode; label: string; kind: Kind }[] = [
  { code: 'ventes', label: "Ventes (chiffre d'affaires)", kind: 'revenu' },
  { code: 'autres_revenus', label: 'Autres revenus et subsides', kind: 'revenu' },
  { code: 'matieres_premieres', label: 'Matières premières', kind: 'cout' },
  { code: 'charges_variables', label: 'Charges variables', kind: 'cout' },
  { code: 'personnel', label: 'Personnel', kind: 'cout' },
  { code: 'charges_fixes', label: 'Charges fixes', kind: 'cout' },
];
export const KIND_OF = Object.fromEntries(CATEGORIES.map((c) => [c.code, c.kind])) as Record<CategoryCode, Kind>;

/** Ligne de la vue public.v_budget_vs_actual */
export interface VarianceRow {
  year: number; month: number; category: CategoryCode; category_label: string; kind: Kind; sort_order: number;
  budget: number; actual: number; prev_actual: number;
}
/** Ligne de la vue public.v_volumes_compare */
export interface VolumeRow {
  year: number; month: number;
  budget_brewed: number; budget_sold: number; actual_brewed: number; actual_sold: number; prev_brewed: number; prev_sold: number;
}

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const eurFmt = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const eur = (v: number) => eurFmt.format(v);
export const nf = (v: number, d = 1) => new Intl.NumberFormat('fr-BE', { maximumFractionDigits: d, minimumFractionDigits: d }).format(v);
export const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${nf(v, 1)} %`);

/** Écart favorable : positif = bon pour la brasserie (revenu en hausse, coût en baisse) */
export const favorable = (kind: Kind, actual: number, ref: number) => (kind === 'revenu' ? actual - ref : ref - actual);
export const pctOf = (diff: number, ref: number): number | null => (ref !== 0 ? (diff / Math.abs(ref)) * 100 : null);
export const tone = (fav: number) => (Math.abs(fav) < 0.005 ? 'text-gray-500' : fav > 0 ? 'text-green-700' : 'text-red-700');
