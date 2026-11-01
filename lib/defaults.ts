// lib/defaults.ts : données et calculs par défaut du Budget (RH, répartition du CA par secteur, achats 60, charges fixes 61).
// Fonctions pures, sans dépendance au navigateur : elles sont utilisées par app/apps/budget/Assistants.tsx.
import { CHART, Z12, accMonths, cloneEntry, emptyEntry, r2, secAccKeys, sum, uid, type Entry, type Plan, type Sub } from './pcmn';
import { DROITS_KEY, GERANCE_KEY } from './projection';
import { ACTUAL_2026, CA_MONTHLY, FIXED_61, RATIOS_60, S60_SHARES } from './defaults-data';

/* ======================================================================
   1. RH & masse salariale (journal de paie UCM n°20, octobre 2026)
   ====================================================================== */
export type Employee = {
  id: string; name: string; role: string; regime: string;
  start: string; end: string | null;   // dates ISO (aaaa-mm-jj) ; fin = fin de contrat prévue
  brut: number;        // brut ONSS mensuel (ATN compris)
  atn: number;         // dont avantage en nature (GSM), récupéré sur le net
  onss: number;        // ONSS patronal net (après réductions)
  transport: number;   // déplacements / avantages hors ONSS (indemnité transport, ...)
  titres: number;      // chèques-repas par mois
  crPart: number;      // part patronale par chèque-repas (8,00 − 1,09)
  telework: number;    // indemnité télétravail
  repres: number;      // frais de représentation
  extras: boolean;     // double pécule et prime de fin d'année
};
export const EMPLOYEES: Employee[] = [
  { id: 'botty', name: 'Arthur BOTTY', role: 'Ventes & Conditionnement', regime: '38h/38h (temps plein)', start: '2024-06-11', end: null, brut: 2855.01, atn: 0, onss: 359.4, transport: 66.72, titres: 21, crPart: 6.91, telework: 0, repres: 0, extras: true },
  { id: 'verleyen', name: 'Sébastien VERLEYEN', role: 'Responsable Production', regime: '38h/38h (temps plein)', start: '2021-01-04', end: null, brut: 3148.32, atn: 0, onss: 696.69, transport: 75.78, titres: 21, crPart: 6.91, telework: 0, repres: 0, extras: true },
  { id: 'mention', name: 'Noah MENTION', role: 'Assistant Sales Management / Master', regime: '22h/38h (apprenti)', start: '2026-09-14', end: '2028-09-12', brut: 1301.28, atn: 0, onss: 119.42, transport: 0, titres: 0, crPart: 6.91, telework: 0, repres: 0, extras: true },
  { id: 'urgyan', name: 'Vanessa URGYAN', role: 'Déléguée commerciale', regime: '30h/38h (temps partiel)', start: '2026-10-01', end: null, brut: 2205.36, atn: 3, onss: 356.47, transport: 0, titres: 18, crPart: 6.91, telework: 130, repres: 90, extras: true },
  // Direction : référentiel 2027 (date d'entrée à confirmer). « Déplacements » = frais, ATN et assurances (287,13 €).
  { id: 'herman', name: 'Stanislas HERMAN', role: 'Directeur (en poste depuis 10 ans, jusqu’au 31/12/2026)', regime: '38h/38h (temps plein)', start: '2016-01-01', end: '2026-12-31', brut: 3151.42, atn: 0, onss: 861.29, transport: 287.13, titres: 20, crPart: 6.91, telework: 0, repres: 0, extras: true },
];
/** Les 4 contrats du journal de paie n°20 (le directeur n'y figure pas) */
export const JOURNAL_IDS = ['botty', 'verleyen', 'mention', 'urgyan'];
/** Référentiel 2027 : consultance management du dirigeant (compte 618000) et droits d'auteur (613400), rangés dans « Personnel externe » */
export const GERANCE_MENSUEL = 6000;
export const DROITS_ANNUEL = 50000;
/** Total annuel de référence RH + direction annoncé pour 2027 (287.034 €) */
export const TOTAL_RH_2027_REF = 287034;
export { GERANCE_KEY, DROITS_KEY };
/** Totaux de référence du journal de paie n°20 (4 contrats, mois complet) */
export const PAIE_REF = { brut: 9509.97, onss: 1531.98, cr: 414.6 };

export type RhParams = {
  from: number;          // 1..12 : premier mois recalculé (les mois précédents restent inchangés)
  dp: number;            // double pécule, en mois de brut (CP 220 : ≈ 0,92)
  pfa: number;           // prime de fin d'année, en mois de brut (≈ 1,00)
  moisDp: number;        // mois de paiement du double pécule (1..12)
  moisPfa: number;       // mois de paiement de la prime de fin d'année
  onssExtraPct: number;  // ONSS patronal brut sur ces paiements (%) : 2.576,17 / 9.509,97 = 27,09 %
  prorata: boolean;      // prorata des jours pour les entrées/sorties en cours de mois
  gerance: number;       // rémunération mensuelle du dirigeant (compte 618000)
  droits: number;        // droits d'auteur, montant annuel lissé (compte 613400)
};
export const RH_DEFAULTS: RhParams = { from: 1, dp: 0.92, pfa: 1, moisDp: 5, moisPfa: 12, onssExtraPct: 27.09, prorata: true, gerance: GERANCE_MENSUEL, droits: DROITS_ANNUEL };
/** coefficient annuel (12 mois + double pécule + prime de fin d'année), ≈ 13,92 */
export const coefAnnuel = (p: Pick<RhParams, 'dp' | 'pfa'>) => r2(12 + p.dp + p.pfa);

/** Comptes alimentés par le module RH : clé du compte → libellé de la ligne de détail */
export const RH_ACCOUNTS: [string, string][] = [
  ['620201', 'Rémunérations employés'], ['620221', 'ATN GSM'], ['740221', 'Récupération ATN GSM'],
  ['625020', 'Provision pécule de vacances et prime (dotation)'], ['620204', 'Double pécule'], ['620205', 'Prime de fin d’année'], ['625120', 'Utilisation / reprise de provision'],
  ['621020', 'ONSS patronal'], ['623100', 'Frais de déplacement'], ['623210', 'Chèques-repas (part patronale)'], ['623280', 'Forfait télétravail'], ['623270', 'Frais de représentation'],
  ['618000', 'Consultance management (dirigeant)'], ['613400', 'Droits d’auteur (consultance externe)'],
];

const dim = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const isoDay = (s: string) => { const [a, b, c] = s.split('-').map(Number); return Date.UTC(a, b - 1, c); };
/** Fraction du mois (0..1) pendant laquelle le contrat est actif */
export function activeFraction(e: Pick<Employee, 'start' | 'end'>, year: number, m: number, prorata = true): number {
  const first = Date.UTC(year, m, 1), last = Date.UTC(year, m, dim(year, m));
  const s = e.start ? isoDay(e.start) : -Infinity, f = e.end ? isoDay(e.end) : Infinity;
  if (s > last || f < first) return 0;
  if (!prorata) return 1;
  const a = Math.max(s, first), b = Math.min(f, last);
  return (Math.round((b - a) / 86400000) + 1) / dim(year, m);
}

/** 12 valeurs mensuelles par compte pour un collaborateur */
export function employeeMonths(e: Employee, year: number, p: RhParams): Record<string, number[]> {
  const out: Record<string, number[]> = {}; RH_ACCOUNTS.forEach(([k]) => { out[k] = Z12(); });
  const appoint = e.brut - e.atn;
  const prov = (coefAnnuel(p) - 12) / 12;
  for (let m = 0; m < 12; m++) {
    const fr = activeFraction(e, year, m, p.prorata); if (!fr) continue;
    out['620201'][m] = appoint * fr;
    if (e.atn) { out['620221'][m] = e.atn * fr; out['740221'][m] = -e.atn * fr; }
    out['621020'][m] = e.onss * fr;
    out['623100'][m] = e.transport * fr;
    out['623210'][m] = e.titres * e.crPart * fr;
    out['623280'][m] = e.telework * fr;
    out['623270'][m] = e.repres * fr;
    if (e.extras) {
      out['625020'][m] = appoint * prov * fr;
      if (m === p.moisDp - 1) { out['620204'][m] = appoint * p.dp; out['621020'][m] += appoint * p.dp * p.onssExtraPct / 100; }
      if (m === p.moisPfa - 1) { out['620205'][m] = appoint * p.pfa; out['621020'][m] += appoint * p.pfa * p.onssExtraPct / 100; }
      out['625120'][m] = -(out['620204'][m] + out['620205'][m]);
    }
  }
  Object.keys(out).forEach((k) => { out[k] = out[k].map(r2); });
  return out;
}

/** Totaux mensuels « de référence » (mois complet, tous les contrats actifs) : à comparer à PAIE_REF */
export function monthlyReference(list: Employee[]) {
  const t = { brut: 0, onss: 0, cr: 0 };
  list.filter((e) => JOURNAL_IDS.includes(e.id)).forEach((e) => { t.brut += e.brut; t.onss += e.onss; t.cr += e.titres * e.crPart; });
  return { brut: r2(t.brut), onss: r2(t.onss), cr: r2(t.cr) };
}

/** Construit les lignes du plan pour le module RH (les mois avant `from` restent tels quels dans une ligne « Existant ») */
export function applyRh(rows: Record<string, Entry>, list: Employee[], year: number, p: RhParams): { rows: Record<string, Entry>; touched: number } {
  const next = { ...rows }; let touched = 0;
  const perEmp = list.map((e) => ({ e, m: employeeMonths(e, year, p) }));
  for (const [key] of RH_ACCOUNTS) {
    const e0 = cloneEntry(rows[key]);
    const before = accMonths(rows[key]);
    const subs: Sub[] = [];
    if (p.from > 1 && before.slice(0, p.from - 1).some((v) => Math.abs(v) >= 0.005)) {
      subs.push({ id: uid(), label: 'Existant (avant le mois ' + p.from + ')', mode: 'monthly', annual: 0, months: before.map((v, i) => (i < p.from - 1 ? r2(v) : 0)) });
    }
    for (const { e, m } of perEmp) {
      const months = m[key].map((v, i) => (i >= p.from - 1 ? v : 0));
      if (months.some((v) => Math.abs(v) >= 0.005)) subs.push({ id: uid(), label: e.name, mode: 'monthly', annual: 0, months });
    }
    if (key === GERANCE_KEY && p.gerance) subs.push({ id: uid(), label: 'Consultance management (dirigeant)', mode: 'monthly', annual: 0, months: Z12().map((_, i) => (i >= p.from - 1 ? r2(p.gerance) : 0)) });
    if (key === DROITS_KEY && p.droits) {
      const n = 13 - p.from; const arr = splitAmount(p.droits * n / 12, Array(n).fill(1));
      subs.push({ id: uid(), label: 'Droits d’auteur (lissés)', mode: 'monthly', annual: 0, months: [...Array(p.from - 1).fill(0), ...arr] });
    }
    const hadSomething = Math.abs(before.reduce((a, b) => a + b, 0)) >= 0.005 || e0.subs.length > 0;
    if (!subs.length && !hadSomething) continue;
    const e: Entry = { mode: 'monthly', annual: 0, months: Z12(), subs };
    if (e0.comment) e.comment = e0.comment;
    next[key] = e; touched++;
  }
  return { rows: next, touched };
}

/* ======================================================================
   2. Répartition du chiffre d'affaires par secteur (ventes par secteur 2025, % du CA)
   ====================================================================== */
export type Sector = { k: string; label: string; desc: string; pct: number };
/** Clés constatées en 2025 (396.402 € de CA) : H 99.641 € = 25,14 %, F 76.422 € = 19,28 %, ... */
export const SECTORS: Sector[] = [
  { k: 'H', label: 'H. Drink', desc: 'Distributeurs boissons', pct: 25.14 },
  { k: 'F', label: 'F. HoReCa', desc: 'Cafés, restaurants, hôtels, tourisme', pct: 19.28 },
  { k: 'D', label: 'D. Épiceries', desc: 'Bio, ferme, épiceries fines', pct: 13.32 },
  { k: 'I', label: 'I. À façon', desc: 'Prestations de brassage et à étiquette', pct: 8.95 },
  { k: 'C', label: 'C. Events', desc: 'Festivités, scouts, écoles', pct: 8.95 },
  { k: "C'", label: "C'. Events Badjawe & POS", desc: 'Events Badjawe, ventes POS (et clients sans secteur)', pct: 7.77 },
  { k: 'B', label: 'B. Coopérateurs', desc: 'Membres, associations, partenaires', pct: 5.84 },
  { k: 'G', label: 'G. Distributeurs', desc: 'Bio, circuit court, alimentaire', pct: 5.24 },
  { k: 'A', label: 'A. Vente directe', desc: 'Particuliers, comptoir, assujettis', pct: 4.89 },
  { k: 'J', label: 'J. Autres & refacturations', desc: 'Achats groupés, refacturations, tarifs personnalisés', pct: 0.63 },
  { k: 'E', label: 'E. Magasins (GMS)', desc: 'Apparu en 2026 : aucune vente en 2025', pct: 0 },
];

/** Répartit `total` (en euros) selon des poids ; les montants verrouillés sont déduits d'abord. Somme exacte au centime. */
export function splitAmount(total: number, weights: number[], locked: (number | null)[] = []): number[] {
  const T = Math.round(total * 100);
  const lockedC = weights.map((_, i) => (locked[i] == null ? null : Math.round((locked[i] as number) * 100)));
  const rest = T - lockedC.reduce<number>((a, v) => a + (v ?? 0), 0);
  const w = weights.map((x, i) => (lockedC[i] == null ? Math.max(0, x) : 0));
  const sw = w.reduce((a, b) => a + b, 0);
  const out = weights.map((_, i) => (lockedC[i] ?? 0));
  if (sw <= 0) return out.map((c) => c / 100);
  const raw = w.map((x) => (rest * x) / sw), base = raw.map(Math.floor);
  let left = rest - base.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - base[i], i] as [number, number]).sort((a, b) => b[0] - a[0]);
  for (let j = 0; left > 0 && j < order.length; j++, left--) base[order[j][1]]++;
  return out.map((c, i) => (lockedC[i] == null ? base[i] : c) / 100);
}

export type Season = 'flat' | '2024' | '2025';
export const SEASON_LABEL: Record<Season, string> = { flat: 'Mois égaux', '2024': 'Saisonnalité réelle 2024', '2025': 'Saisonnalité réelle 2025' };
export const seasonWeights = (s: Season): number[] => (s === 'flat' ? Array(12).fill(1) : CA_MONTHLY[+s].slice());
/** Répartit un montant annuel sur 12 mois (somme exacte au centime) */
export const spreadYear = (amount: number, s: Season): number[] => splitAmount(amount, seasonWeights(s));

export type CaTarget = { amount: number; kind: 'annual' | 'monthly'; season: Season; account: string; zeroOthers: boolean };
export const CA_DEFAULTS: CaTarget = { amount: 0, kind: 'annual', season: '2025', account: '701000', zeroOthers: true };
export const caAnnual = (t: Pick<CaTarget, 'amount' | 'kind'>) => r2(t.kind === 'monthly' ? t.amount * 12 : t.amount);

/** Écrit les lignes de secteur dans le compte porteur de la classe 70 */
export function applyCa(rows: Record<string, Entry>, amounts: { label: string; amount: number }[], t: CaTarget): { rows: Record<string, Entry>; zeroed: number } {
  const next = { ...rows }; let zeroed = 0;
  const season: Season = t.kind === 'monthly' ? 'flat' : t.season;
  const e0 = cloneEntry(rows[t.account]);
  const subs: Sub[] = amounts.filter((a) => Math.abs(a.amount) >= 0.005).map((a) => (season === 'flat'
    ? { id: uid(), label: a.label, mode: 'annual', annual: r2(a.amount), months: Z12() } as Sub
    : { id: uid(), label: a.label, mode: 'monthly', annual: 0, months: spreadYear(a.amount, season) } as Sub));
  const e: Entry = { mode: 'monthly', annual: 0, months: Z12(), subs };
  if (e0.comment) e.comment = e0.comment;
  next[t.account] = e;
  if (t.zeroOthers) {
    const sec = CHART.find((s) => s.k === 's70');
    for (const k of sec ? secAccKeys(sec) : []) {
      if (k === t.account) continue;
      const cur = rows[k]; if (!cur || (!cur.subs.length && Math.abs(accMonths(cur).reduce((a, b) => a + b, 0)) < 0.005)) continue;
      const z = emptyEntry(); if (cur.comment) z.comment = cur.comment; next[k] = z; zeroed++;
    }
  }
  return { rows: next, zeroed };
}

/* ======================================================================
   3. Achats de la classe 60 : ratio du CA (28 % à 33 %), réparti selon la structure réelle des comptes
   ====================================================================== */
export const RATIO_60_DEFAULT = 30.2; // (119.966 + 91.136) / (396.402 + 302.781) : 2025 + janv.–oct. 2026
export const RATIO_60_RANGE: [number, number] = [28, 33];
export const isStockAccount = (k: string) => /^(609|710)/.test(k);

export const caMonthsOf = (rows: Record<string, Entry>): number[] => {
  const sec = CHART.find((s) => s.k === 's70'); const t = Z12();
  for (const k of sec ? secAccKeys(sec) : []) accMonths(rows[k]).forEach((v, i) => { t[i] += v; });
  return t;
};

export function applyAchats(rows: Record<string, Entry>, pct: number, from: number, zeroOthers: boolean): { rows: Record<string, Entry>; n: number; total: number } {
  const next = { ...rows }; const ca = caMonthsOf(rows); let n = 0, total = 0;
  const sec = CHART.find((s) => s.k === 's60'); const keys = sec ? secAccKeys(sec) : [];
  const share: Record<string, number> = {}; S60_SHARES.forEach(([k, w]) => { share[k] = w; });
  for (const k of keys) {
    const cur = rows[k]; const before = accMonths(cur);
    const w = share[k];
    if (w === undefined && !(zeroOthers && (isStockAccount(k) || (cur && (cur.subs.length || before.some((v) => Math.abs(v) >= 0.005)))))) continue;
    const months = before.map((v, i) => (i < from - 1 ? r2(v) : w === undefined ? 0 : r2(Math.max(0, ca[i]) * (pct / 100) * w)));
    const e = cloneEntry(cur); e.subs = []; e.mode = 'monthly'; e.annual = 0; e.months = months;
    next[k] = e; n++; total += months.reduce((a, b) => a + b, 0);
  }
  return { rows: next, n, total: r2(total) };
}

/* ======================================================================
   4. Charges fixes récurrentes (classe 61 et énergie)
   ====================================================================== */
export type FixedLine = { code: string; on: boolean; monthly: number };
export const fixedDefaults = (): FixedLine[] => FIXED_61.map((f) => ({ code: f.code, on: f.rec, monthly: f.monthly }));
export function applyFixed(rows: Record<string, Entry>, lines: FixedLine[], from: number): { rows: Record<string, Entry>; n: number } {
  const next = { ...rows }; let n = 0;
  for (const l of lines) {
    if (!l.on) continue;
    const cur = rows[l.code]; const before = accMonths(cur);
    const e = cloneEntry(cur); e.subs = []; e.mode = 'monthly'; e.annual = 0;
    e.months = before.map((v, i) => (i < from - 1 ? r2(v) : r2(l.monthly)));
    next[l.code] = e; n++;
  }
  return { rows: next, n };
}

/* ======================================================================
   5. Atterrissage 2026 : 10 mois réels du grand livre + 2 mois extrapolés
   ====================================================================== */
export const ATTERRISSAGE_2026 = { caReel10: 302781.46, caTotal: 380560 };

/** Plan 2026 complet : janv.–oct. = réalisé comptable ; nov.–déc. = extrapolation (CA total 380.560 €, achats au ratio réel, RH de la paie, charges fixes récurrentes, moyenne pour le reste) */
/** Nov.–déc. 2026 : salariés du journal de paie d'octobre ; le directeur (absent du journal par erreur) est réintégré sur tout le 4e trimestre : octobre (ajouté au réalisé), novembre, décembre + prime de fin d'année */
export function buildAtterrissage2026(list: Employee[] = EMPLOYEES.filter((e: Employee) => JOURNAL_IDS.includes(e.id))): { rows: Record<string, Entry>; ca: number; caReel: number } {
  const monthsOf = (k: string): number[] => (ACTUAL_2026[k] || Array(10).fill(0)).concat([0, 0]);
  const rows: Record<string, Entry> = {};
  const secOf: Record<string, string> = {};
  CHART.forEach((sec) => secAccKeys(sec).forEach((k) => { secOf[k] = sec.k; }));
  const s70 = secAccKeys(CHART.find((s) => s.k === 's70')!);
  const caReel = r2(s70.reduce((a, k) => a + sum((ACTUAL_2026[k] || []).slice(0, 10)), 0));
  const rest = r2(ATTERRISSAGE_2026.caTotal - caReel);
  const [nov, dec] = splitAmount(rest, [CA_MONTHLY[2025][10], CA_MONTHLY[2025][11]]);
  const ratio = (RATIOS_60.find((r) => r.year === 2026)?.pct ?? RATIO_60_DEFAULT) / 100;
  const share: Record<string, number> = {}; S60_SHARES.forEach(([k, w]) => { share[k] = w; });
  const rh: Record<string, number[]> = {}; RH_ACCOUNTS.forEach(([k]) => { rh[k] = Z12(); });
  const params: RhParams = { ...RH_DEFAULTS, from: 11, gerance: 0, droits: 0 };
  list.forEach((e) => { const m = employeeMonths(e, 2026, params); RH_ACCOUNTS.forEach(([k]) => { m[k].forEach((v, i) => { rh[k][i] += v; }); }); });
  const oct: Record<string, number> = {}; // octobre du directeur, à ajouter au réalisé comptable
  const dirEmp = EMPLOYEES.find((e) => e.id === 'herman');
  if (dirEmp) { const hm = employeeMonths(dirEmp, 2026, params); RH_ACCOUNTS.forEach(([k]) => { rh[k][10] += hm[k][10]; rh[k][11] += hm[k][11]; oct[k] = hm[k][9]; }); }
  const fixed: Record<string, number> = {}; FIXED_61.forEach((f) => { if (f.rec) fixed[f.code] = f.monthly; });
  const caM = Z12(); // CA mensuel du plan (réel puis extrapolé)
  s70.forEach((k) => monthsOf(k).forEach((v, i) => { caM[i] += v; }));
  caM[10] += nov; caM[11] += dec;
  const keys = new Set<string>([...Object.keys(ACTUAL_2026), ...Object.keys(rh).filter((k) => sum(rh[k]) !== 0), '701000']);
  keys.forEach((k) => {
    const m = monthsOf(k); const sec = secOf[k]; if (!sec) return;
    const act = m.slice(0, 10); const active = act.filter((v) => Math.abs(v) >= 0.005).length; const avg = sum(act) / 10;
    let n: number, d: number;
    if (k === '701000') { n = nov; d = dec; }
    else if (sec === 's70') { n = 0; d = 0; }
    else if (rh[k] && sum(rh[k]) !== 0) { n = rh[k][10]; d = rh[k][11]; }
    else if (k === '749030' || k === '749050' || k === '621900') { n = 0; d = 0; }
    else if (sec === 's60') { const w = isStockAccount(k) ? 0 : share[k] || 0; n = caM[10] * ratio * w; d = caM[11] * ratio * w; }
    else if (fixed[k] !== undefined) { n = fixed[k]; d = fixed[k]; }
    else if (isStockAccount(k) || active < 5) { n = 0; d = 0; }
    else { n = avg; d = avg; }
    if (oct[k]) act[9] = r2(act[9] + oct[k]);
    const months = act.concat([r2(n), r2(d)]);
    rows[k] = { mode: 'monthly', annual: 0, months, subs: [] };
  });
  // comptes à alimenter même sans réalisé (achats de la structure réelle, charges fixes) : seulement nov.–déc.
  S60_SHARES.forEach(([k, w]) => { if (!rows[k]) rows[k] = { mode: 'monthly', annual: 0, months: [...Array(10).fill(0), r2(caM[10] * ratio * w), r2(caM[11] * ratio * w)], subs: [] }; });
  return { rows, ca: r2(sum(caM)), caReel };
}

export type { Plan };
export { ACTUAL_2026, CA_MONTHLY, FIXED_61, RATIOS_60, S60_SHARES };
