// lib/projection.ts : ratios financiers de la projection pluriannuelle (fonctions pures, sans dépendance au navigateur)
import { CHART, Z12, accMonths, addTo, results, secAccKeys, sum, type Entry } from './pcmn';

/** Comptes de direction (consultance management 618000 et droits d'auteur 613400, rangés dans « Personnel externe ») : comptés avec le personnel */
export const GERANCE_KEY = '618000';
export const DROITS_KEY = '613400';

export type Kpis = {
  ca: number;          // chiffre d'affaires (classe 70)
  achats: number;      // achats matières et marchandises (classe 60)
  mb: number;          // marge brute = CA − achats (60)
  mbPct: number;       // taux de marge brute = MB / CA
  rh: number;          // personnel = classe 62 + gérance (618) + droits d'auteur
  rhSalaries: number;  // dont classe 62
  rhDirection: number; // dont gérance + droits d'auteur
  rhPctCa: number; rhPctMb: number;
  fg: number;          // frais généraux = classe 61
  fgPctCa: number; fgPctMb: number;
  fixed: number;       // charges fixes totales (voir fixedParts)
  breakeven: number;   // seuil de rentabilité = charges fixes / taux de marge brute
  ebitda: number;      // EBITDA du plan
  result: number;      // marge brute − personnel − frais généraux
  netResult: number;   // résultat de l'exercice (net)
  fixedParts: { label: string; v: number }[];
};

const div = (a: number, b: number) => (Math.abs(b) < 0.005 ? 0 : a / b);

/** Totaux mensuels de chaque section du plan */
export function sectionMonths(rows: Record<string, Entry>): Record<string, number[]> {
  const S: Record<string, number[]> = {};
  CHART.forEach((s) => { const t = Z12(); secAccKeys(s).forEach((k) => addTo(t, accMonths(rows[k]))); S[s.k] = t; });
  return S;
}

/** Ratios d'une année (ou d'un scénario) à partir des lignes du plan */
export function computeKpis(rows: Record<string, Entry>): Kpis {
  const S = sectionMonths(rows); const T = (k: string) => sum(S[k] || Z12());
  const R = results(S, 12);
  const dir = sum(accMonths(rows[GERANCE_KEY])) + sum(accMonths(rows[DROITS_KEY]));
  const ca = T('s70'), achats = T('s60'), mb = ca - achats;
  const rhSalaries = T('s62'), rh = rhSalaries + dir, fg = T('s61');
  // charges fixes = toutes les charges sauf les achats (60), diminuées des autres produits d'exploitation
  const parts = [
    { label: 'Personnel (62 + gérance + droits d’auteur)', v: rh }, { label: 'Frais généraux (61)', v: fg }, { label: 'Consultances externes hors direction', v: T('pext') - dir }, { label: 'Énergie et eau', v: T('nrj') },
    { label: 'Amortissements, réductions de valeur, provisions', v: T('s630') + T('s631') + T('s635') }, { label: 'Autres charges d’exploitation (640, 649)', v: T('s640') + T('s649') },
    { label: 'Charges financières (65)', v: T('s65') },
    { label: 'Moins : autres produits (74, 71;74, 75, vinaigrerie net)', v: -(T('s74') + T('s7174') + T('vin') + T('s75')) },
  ];
  const fixed = parts.reduce((a, p) => a + p.v, 0);
  const mbPct = div(mb, ca);
  return {
    ca, achats, mb, mbPct, rh, rhSalaries, rhDirection: dir, rhPctCa: div(rh, ca), rhPctMb: div(rh, mb), fg, fgPctCa: div(fg, ca), fgPctMb: div(fg, mb),
    fixed, breakeven: mbPct > 0 ? fixed / mbPct : 0, ebitda: sum(R.ebitda), result: mb - rh - fg, netResult: sum(R.net), fixedParts: parts,
  };
}
