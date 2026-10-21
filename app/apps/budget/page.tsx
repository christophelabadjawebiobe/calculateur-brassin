'use client';
/* =====================================================================
   app/apps/budget/page.tsx : Budget prévisionnel (PCMN) de la Brasserie coopérative La Badjawe
   - structure comptable issue de « creation budjet.xlsx » (classes 70, 74, 60, 61, 62, 63, 64, 65, 66, 67…)
   - année 2026 mois par mois + trimestres T1-T4 + total ; historique 2023-2025 repliable
   - saisie mensuelle ou annuelle (répartie sur 12 mois), variation en %, sous-lignes de détail
   - indicateurs en temps réel : CA, marge brute, EBITDA, résultat d'exploitation, résultat net
   Données : tables pcmn_budget_plans (budget) et pcmn_budget_history (réalisé 2023-2025) : voir sql/02_budget_pcmn.sql
   ===================================================================== */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { createClient } from '@/lib/supabase/client';

/* ---------- types ---------- */
type Mode = 'annual' | 'monthly';
type Leaf = { mode: Mode; annual: number; months: number[] };
type Sub = Leaf & { id: string; label: string };
type Entry = Leaf & { subs: Sub[] };
type Plan = { v: 1; rows: Record<string, Entry> };
type Acc = [string, string, string]; // clé, code, libellé
type Sec = { k: string; code: string; label: string; kind: 'rev' | 'cost' | 'net'; groups: { label: string | null; accounts: Acc[] }[] };
type Hist = Record<string, Record<number, number>>;

const YEAR = 2026;
const HIST_YEARS = [2023, 2024, 2025];
const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avril', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
const TABLE_PLAN = 'pcmn_budget_plans', TABLE_HIST = 'pcmn_budget_history';

/* ---------- plan comptable (structure du fichier Excel) ---------- */
const CHART: Sec[] = [{"k":"s70","code":"70","label":"Chiffre d'affaires","kind":"rev","groups":[{"label":null,"accounts":[["700100","700100","Ventes (compte à ne plus utiliser)"],["700000","700000","Ventes en Belgique (marchandises)"],["700110","700110","Ventes de produits à Façon"],["701000","701000","Ventes en Belgique (produits finis)"],["701100","701100","Ventes dans les pays membres de la C.E.E. (produits finis)"],["700300","700300","Ventes diverses"],["700400","700400","Ventes lors d'événements"],["700600","700600","Ventes de Packaging"],["708800","708800","Echantillons pour clients"],["703000","703000","Locations à caractère Professionnel"]]}]},{"k":"s74","code":"74","label":"Autres produits","kind":"rev","groups":[{"label":null,"accounts":[["743100","743100","Frais de livraison"],["743110","743110","Revente de matériel"],["743130","743130","Refacturation de prestations"],["743150","743150","Refac. mat. premières & bouteilles vides"]]}]},{"k":"s60","code":"60","label":"Approvisionnements, marchandises","kind":"cost","groups":[{"label":null,"accounts":[["600000","600000","Achats de matières premières"],["600004","600004","Emballages - leasing de fûts"],["600005","600005","Emballages - bouteilles et étiquettes"],["600006","600006","Nettoyage d'emballages réutilisables"],["600007","600007","Bonbonne CO2"],["600008","600008","Emballages - autres packaging"],["600009","600009","Achats pour tests"],["600010","600010","Accises"],["600015","600015","FostPlus"],["600016","600016","Emballages - cannettes"],["601000","601000","Achats de fournitures"],["601700","601700","Fournitures diverses et petit outillage"],["613050","613050","Frais de livraisons des fournisseurs"],["613055","613055","Frais de livraisons clients"],["602000","602000","Frais d'analyse, frais de laboratoire"],["603020","603020","Sous-traitant Encannage"],["603000","603000","Sous-traitances générales"],["603010","603010","Sous-traitant maintenance"],["603021","603021","Sous-traitant (aide) soutirage"],["603030","603030","Sous-traitant autres prestations"],["603040","603040","Sous-traitant gestion de projets"],["603050","603050","km remboursés aux sous-traitants"],["604000","604000","Achats pour événements"],["615220","615220","Participation foires, expo., …"],["613000","613000","Commissions Summer Beer Lovers Festival"],["604005","604005","Achats pour événement - Court Circuit"],["604040","604040","Achats de marchandises : verres Badjawe, ..."],["605000","605000","Echantillons pour analyses , concours"],["609000","609000","Variation des stocks matières premières"],["609100","609100","Variation des stocks fournitures"],["609200","609200","Variation des stocks produits en cours"],["609400","609400","Variation des stocks produits en cours"],["609800","609800","Variation - échantillons"],["710200","710200","Variation des stocks produits en cours de fabrication"],["710000","710000","Variation des stocks produits finis"]]}]},{"k":"nrj","code":"","label":"Énergie et eau","kind":"cost","groups":[{"label":null,"accounts":[["611120","611120","Charges bâtiment Alleur"],["612110","612110","Gaz"],["612120","612120","Electricité"],["612200","612200","Produits d'entretien"]]}]},{"k":"s7174","code":"71;74","label":"Autres produits d'exploitation","kind":"rev","groups":[{"label":null,"accounts":[["740000","740000","Facturation Terravia"],["740010","740010","Remboursement par assurance"],["740020","740020","Indemnisation reçue"],["740040","740040","Autres subsides"],["742010","742010","Régularisation clients et fournisseurs"],["746000","746000","Produits d'exploitation divers"]]}]},{"k":"vin","code":"","label":"Vinaigrerie (solde net)","kind":"net","groups":[{"label":null,"accounts":[["x80","","Vente de vinaigre GoCircular"],["740030","740030","Subsides GoCircular (70% des dépenses)"],["740060","740060","Subsides GoCircular Invest (70% des dépenses)"],["613230","613230","Prestations informatiques"],["602010","602010","Achats et prestations pour GoCircular (100%)"],["613220","613220","Prestations production"],["630240","630240","Dot. Amort. s/investissements vinaigrerie"],["x87","","Autres frais"],["x88","","Prestations"],["x89","","trft vinaigrerie subside"],["x90","","trft vinaigrerie frais de bureau"],["x91","","trft vinaigrerie AFSCA"],["x92","","trft vinaigrerie support"],["x93","","trft vinaigrerie honoraires"],["x94","","trft vinaigrerie rému"],["612000","612000","Compte 612000"]]}]},{"k":"s61","code":"61","label":"Services et biens divers","kind":"cost","groups":[{"label":"Locaux et charges","accounts":[["611100","611100","Loyers bâtiment à Alleur"],["611200","611200","Prestations de nettoyage"],["611410","611410","Entretien et rép. - Constructions"],["611520","611520","Entretien et rép. - matériel"],["611530","611530","Entretien et rép. matériel de service mobile (pompe mis à disposition) (ne plus utiliser)"],["611000","611000","Entretien et réparation"]]},{"label":"Déplacements","accounts":[["615100","615100","Déplacements : NDF, parking, etc."],["614002","614002","Entretiens et réparations véhicules"],["614003","614003","Assurances véhicules"],["614004","614004","Carburant"],["614005","614005","Parking"],["614010","614010","Location matériel"]]},{"label":"Frais de bureau","accounts":[["612420","612420","Fournitures de bureau diverses"],["612500","612500","Téléphone"],["612510","612510","GSM"],["612520","612520","Internet, site, hébergement, mail box"],["612530","612530","Licences informatiques"],["612550","612550","Frais postaux"]]},{"label":"Assurances","accounts":[["613500","613500","Assurance incendie et frais généraux"],["613510","613510","Assurance contre le vol"],["613530","613530","Assurance responsabilité civile"]]},{"label":"Honoraires experts et comptabilité","accounts":[["615300","615300","Frais de dépôts cptes annuels"],["615310","615310","publication au Moniteur Belge"],["613240","613240","Prestations admin et financières"],["613241","613241","Prestations Gestion RH"],["613250","613250","Prestations suport admin"],["613260","613260","Expert-comptable"]]},{"label":"Frais de communication et relations clients","accounts":[["614000","614000","Frais de circonstances (fleurs)"],["615110","615110","Frais de circonstances (fleurs)"],["615120","615120","Participation à des cours, …"],["615150","615150","Frais de réception, réunion"],["615240","615240","Objets publicitaires / marketing"],["615260","615260","Objets publicitaires / gob réutilisables"],["615270","615270","Sponsoring (avec ventes en contre-partie)"]]},{"label":"Frais spécifiques à l'activité","accounts":[["613310","613310","Certification bio"],["615400","615400","Cotisations AFSCA"],["615410","615410","Cotisations déchets"],["615420","615420","Cotisations groupement professionnels"],["615450","615450","Frais pour événements BtoB"],["615140","615140","Frais de R&D, documentation"],["612430","612430","Petit matériel"],["613280","613280","Prestation bar"],["613051","613051","Stockage de palettes avant livraison"],["613270","613270","Prestations support / gestion des commandes"]]}]},{"k":"pext","code":"","label":"Personnel externe","kind":"cost","groups":[{"label":null,"accounts":[["613210","613210","Avocats"],["613245","613245","Consultances"],["613290","613290","Autres experts"],["613100","613100","Honoraires divers"]]}]},{"k":"s62","code":"62","label":"Rémunérations, charges sociales et pensions","kind":"cost","groups":[{"label":null,"accounts":[["620201","620201","Rémunérations employés"],["620202","620202","Rémunérations employés (JF/non presté/récup)"],["620203","620203","Rémunérations employés (congés payés)"],["620204","620204","Rémunérations employés (double pécule)"],["625020","625020","Dotation provision PV - employés"],["625120","625120","Util. / reprise provision PV - employés"],["620205","620205","Rémunérations employés (PFA/primes)"],["620221","620221","Rémunérations employés / ATN GSM"],["620222","620222","Rémunérations employés / ATN abon.GSM"],["620223","620223","Rémunérations employés / ATN internet mobile"],["740221","740221","Récupération ATN GSM"],["740222","740222","Récupération ATN abon.GSM"],["740223","740223","Récupération ATN internet mobile"],["740050","740050","Plan SESAM"],["621020","621020","Cotisations ONSS sur salaires - employés"],["621900","621900","Redistribution charges ONSS"],["749030","749030","Réductions charges sociales"],["749050","749050","Réduction Précompte"],["620301","620301","Rémunérations ouvriers (heures prestées)"],["620302","620302","Rémunérations ouvriers (JF/non presté/récup)"],["620303","620303","Rémunérations ouvriers (pécule vacances)"],["620306","620306","Rémunérations ouvriers (maladie)"],["625030","625030","Dotation provision PV - ouvriers"],["625130","625130","Util. / reprise provisions PV - ouvriers"],["621030","621030","Cotisations ONSS sur salaires - ouvriers"],["623100","623100","Frais de déplacement"],["623210","623210","Chèque-repas"],["623211","623211","Chèque-repas déductibles"],["749100","749100","Chèques-repas - part travailleur"],["623240","623240","Ecochèques"],["613330","613330","Prestations Edenred"],["623220","623220","Frais de cantine"],["623230","623230","Vêtements de travail"],["623250","623250","Participation assurance soins de santé"],["623260","623260","Participation assurance groupe"],["623270","623270","Remboursement frais de représentation"],["623280","623280","Remboursement forfait télétravail"],["623000","623000","Assurance-loi, RC & chemin du travail"],["623200","623200","Service médical, médecine du travail"],["613300","613300","Secrétariat social (fixe)"],["613301","613301","Secrétariat social (variable)"],["749040","749040","Intervention frais secrétariat social"],["616700","616700","Restaurants + repas annuel d'équipe"]]}]},{"k":"s630","code":"630","label":"Amortissements sur immobilisations","kind":"cost","groups":[{"label":null,"accounts":[["630220","630220","Dot. Amort. s/install., mach., outillage"],["630230","630230","Dot. Amort. s/ mobilier et mat. Roulant"],["630200","630200","Dotations aux amortissements sur immobilisations corporelles"]]}]},{"k":"s631","code":"631;634","label":"Réductions de valeur sur stocks et créances","kind":"cost","groups":[{"label":null,"accounts":[["634000","634000","Réductions de valeur sur créances"]]}]},{"k":"s635","code":"635;637","label":"Provisions pour risques et charges","kind":"cost","groups":[]},{"k":"s640","code":"640","label":"Autres charges d'exploitation","kind":"cost","groups":[{"label":null,"accounts":[["640010","640010","Cotisation des sociétés"],["640040","640040","Taxe de circulation - Utilitaires"],["640050","640050","Précompte immobilier"],["640120","640120","TVA non déductible"],["640250","640250","Taxes sur l'environnement"],["640800","640800","Pertes sur stock / défauts"],["640700","640700","Autres charges d'exploitation"],["642010","642010","Régularisation fournisseurs"]]}]},{"k":"s649","code":"649","label":"Charges d'exploitation portées à l'actif (restructuration)","kind":"cost","groups":[]},{"k":"s75","code":"75","label":"Produits financiers","kind":"rev","groups":[{"label":null,"accounts":[["751000","751000","Produits des actifs circulants"],["756000","756000","Produits financiers divers"],["758200","758200","Différence sur paiements"]]}]},{"k":"s65","code":"65","label":"Charges financières","kind":"cost","groups":[{"label":null,"accounts":[["650000","650000","Intérêts sur crédit SOWECSOM"],["650010","650010","Intérêts crédit Credal"],["650015","650015","Intérêts crédit W.Alter 2025 50K"],["650020","650020","Compte 650020"],["650410","650410","Intérêts de retard sur TVA"],["650430","650430","Intérêts de retard ONSS"],["657200","657200","Frais de transac. s/ terminal de paiem."],["658100","658100","Différences de caisse"],["658200","658200","Différences sur paiements"],["659000","659000","Frais bancaires"]]}]},{"k":"s76","code":"76","label":"Produits exceptionnels","kind":"rev","groups":[{"label":null,"accounts":[["760100","760100","Régularisations et produits divers années précédentes"]]}]},{"k":"s66","code":"66","label":"Charges exceptionnelles","kind":"cost","groups":[{"label":null,"accounts":[["660100","660100","Autres charges diverses années antérieures"],["641000","641000","Moins values sur réalisation d'immobilisations corporelles"],["x263","","Autres charges exceptionnelles (non ventilées)"]]}]},{"k":"s67","code":"67","label":"Impôts","kind":"cost","groups":[{"label":null,"accounts":[["670000","670000","Impôts"],["670300","670300","Précompte Mobilier"]]}]}];

/* ---------- colonnes : 12 mois, trimestres après mars/juin/sept./déc., total ---------- */
type Col = { t: 'm' | 'q'; i: number };
const COLS: Col[] = [];
for (let q = 0; q < 4; q++) { for (let j = 0; j < 3; j++) COLS.push({ t: 'm', i: q * 3 + j }); COLS.push({ t: 'q', i: q }); }

/* ---------- calcul ---------- */
const Z12 = (): number[] => Array(12).fill(0);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const addTo = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) a[i] += b[i] || 0; return a; };
const leafMonths = (e?: Leaf): number[] => (!e ? Z12() : e.mode === 'annual' ? Array(12).fill((e.annual || 0) / 12) : Z12().map((_, i) => (e.months && e.months[i]) || 0));
const accMonths = (e?: Entry): number[] => (e && e.subs && e.subs.length ? e.subs.reduce((a, s) => addTo(a, leafMonths(s)), Z12()) : leafMonths(e));
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const quarter = (m: number[], q: number) => m[q * 3] + m[q * 3 + 1] + m[q * 3 + 2];
const colVal = (m: number[], c: Col) => (c.t === 'm' ? m[c.i] : quarter(m, c.i));

/** Formules du fichier Excel (colonnes 2026) : chaque série est un tableau de nombres (12 mois, ou 1 valeur par année d'historique). */
function results(S: Record<string, number[]>, n: number) {
  const g = (k: string) => S[k] || Array(n).fill(0);
  const out: Record<string, number[]> = {};
  const f = (fn: (i: number) => number) => Array.from({ length: n }, (_, i) => fn(i));
  const s70 = g('s70'), s74 = g('s74'), s60 = g('s60'), nrj = g('nrj'), s7174 = g('s7174'), vin = g('vin'), s61 = g('s61'), pext = g('pext'), s62 = g('s62');
  const s630 = g('s630'), s631 = g('s631'), s635 = g('s635'), s640 = g('s640'), s649 = g('s649'), s75 = g('s75'), s65 = g('s65'), s76 = g('s76'), s66 = g('s66'), s67 = g('s67');
  out.mb = f((i) => s70[i] + s74[i] - s60[i] - nrj[i]);
  out.mbe = f((i) => out.mb[i] + s7174[i] + vin[i] - s61[i]);
  out.re = f((i) => out.mbe[i] - pext[i] - s62[i] - s630[i] - s631[i] - s635[i] - s640[i] - s649[i]);
  out.ebitda = f((i) => out.re[i] + s630[i] + s631[i] + s635[i]);
  out.rc = f((i) => out.re[i] + s75[i] - s65[i]);
  out.rai = f((i) => out.rc[i] + s76[i] - s66[i]);
  out.net = f((i) => out.rai[i] - s67[i]);
  out.cash = f((i) => out.net[i] + s630[i]);
  return out;
}
const RES_AFTER: Record<string, string[]> = { nrj: ['mb'], s61: ['mbe'], s649: ['re', 'ebitda'], s65: ['rc'], s66: ['rai'], s67: ['net', 'cash'] };
const RES_LABEL: Record<string, string> = {
  mb: 'Marge brute', mbe: "Marge brute d'exploitation", re: "Résultat d'exploitation",
  ebitda: 'EBITDA', rc: 'Résultat courant avant impôts', rai: "Résultat de l'exercice avant impôts", net: "Résultat de l'exercice (net)", cash: 'Cash flow',
};
const RES_HINT: Record<string, string> = {
  mb: "Chiffre d'affaires (70) + autres produits (74) − approvisionnements (60) − énergie",
  mbe: "Marge brute + autres produits d'exploitation (71;74) + vinaigrerie (net) − services et biens divers (61)",
  re: "Marge brute d'exploitation − personnel externe − rémunérations (62) − amortissements (630) − réductions de valeur (631;634) − provisions (635;637) − autres charges (640) − 649",
  ebitda: "Résultat d'exploitation + amortissements (630) + réductions de valeur (631;634) + provisions (635;637)",
  rc: "Résultat d'exploitation + produits financiers (75) − charges financières (65)",
  rai: 'Résultat courant + produits exceptionnels (76) − charges exceptionnelles (66)',
  net: 'Résultat avant impôts − impôts (67)',
  cash: 'Résultat de l’exercice + amortissements (630)',
};

const emptyEntry = (): Entry => ({ mode: 'annual', annual: 0, months: Z12(), subs: [] });
const cloneEntry = (e?: Entry): Entry => (e ? { mode: e.mode, annual: e.annual || 0, months: leafMonthsRaw(e), subs: (e.subs || []).map((s) => ({ id: s.id, label: s.label, mode: s.mode, annual: s.annual || 0, months: leafMonthsRaw(s) })) } : emptyEntry());
const leafMonthsRaw = (e: Leaf) => Z12().map((_, i) => (e.months && e.months[i]) || 0);
const uid = () => Math.random().toString(36).slice(2, 9);
const parseNum = (t: string) => { const v = parseFloat(String(t).replace(/\s| /g, '').replace(',', '.')); return isFinite(v) ? v : 0; };
const nf0 = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n: number) => (Math.abs(n) < 0.5 ? '0' : nf0.format(Math.round(n)));
const eur0 = (n: number) => nf0.format(Math.round(n)) + ' €';
const pctTxt = (a: number, b: number) => (Math.abs(b) < 0.5 ? '—' : (a - b >= 0 ? '+' : '−') + nf0.format(Math.abs(((a - b) / Math.abs(b)) * 100)) + ' %');

/** Variation en % appliquée aux lignes de saisie (jamais aux sous-totaux) */
function applyPct(plan: Plan, keys: string[], pct: number, basis: 'current' | 'hist' | 'chain', hist: Hist): Plan {
  const f = 1 + pct / 100;
  const rows = { ...plan.rows };
  for (const k of keys) {
    const e = cloneEntry(rows[k]);
    const hasSubs = e.subs.length > 0;
    const leaves: Leaf[] = hasSubs ? e.subs : [e];
    for (const L of leaves) {
      const useHist = basis === 'hist' && !hasSubs;
      if (useHist) {
        const base = ((hist[k] || {})[HIST_YEARS[HIST_YEARS.length - 1]] || 0) / 12;
        L.mode = 'monthly'; L.months = Z12().map(() => r2(base * f));
      } else if (basis === 'chain') {
        const m0 = leafMonths(L)[0];
        L.mode = 'monthly'; L.months = Z12().map((_, i) => r2(m0 * Math.pow(f, i)));
      } else if (L.mode === 'annual') L.annual = r2(L.annual * f);
      else L.months = L.months.map((x) => r2(x * f));
    }
    rows[k] = e;
  }
  return { ...plan, rows };
}

/* ====================================================================
   Composants de la grille
   ==================================================================== */
function NumCell({ value, onChange, disabled, label, cls }: { value: number; onChange: (n: number) => void; disabled?: boolean; label: string; cls?: string }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text != null ? text : value ? fmt0(value) : '';
  return (
    <input className={'bd-in ' + (cls || '')} type="text" inputMode="decimal" aria-label={label} disabled={disabled} value={shown} placeholder="0"
      onFocus={(e) => { const raw = value ? String(r2(value)).replace('.', ',') : ''; e.target.value = raw; e.target.select(); setText(raw); }}
      onBlur={() => setText(null)}
      onChange={(e) => { setText(e.target.value); onChange(r2(parseNum(e.target.value))); }} />
  );
}

function toggleLeafMode(l: Leaf) {
  if (l.mode === 'annual') {
    const m = r2(l.annual / 12); l.months = Z12().map(() => m);
    l.months[11] = r2(l.annual - m * 11); l.mode = 'monthly';
  } else { l.annual = r2(sum(l.months)); l.mode = 'annual'; }
}

type EditFn = (key: string, fn: (e: Entry) => void) => void;

const HistCells = memo(function HistCells({ vals, show }: { vals: (number | undefined)[]; show: boolean }) {
  if (!show) return null;
  return <>{vals.map((v, i) => <td key={i} className="n hist">{v === undefined ? '' : fmt0(v)}</td>)}</>;
});

function TotalCells({ months, h25, cls }: { months: number[]; h25: number | undefined; cls?: string }) {
  const t = sum(months);
  return (
    <>
      <td className={'n tot ' + (cls || '')}>{fmt0(t)}</td>
      <td className={'n delta ' + (cls || '')}>{h25 === undefined ? '' : pctTxt(t, h25)}</td>
    </>
  );
}

function MonthCells({ months, cls }: { months: number[]; cls?: string }) {
  return <>{COLS.map((c, i) => <td key={i} className={'n ' + (c.t === 'q' ? 'q ' : '') + (cls || '')}>{fmt0(colVal(months, c))}</td>)}</>;
}

function LeafCells({ leaf, ro, edit, label }: { leaf: Leaf; ro: boolean; edit: (fn: (l: Leaf) => void) => void; label: string }) {
  const m = leafMonths(leaf);
  return (
    <>
      {COLS.map((c, i) => c.t === 'q'
        ? <td key={i} className="n q">{fmt0(quarter(m, c.i))}</td>
        : leaf.mode === 'monthly' && !ro
          ? <td key={i} className="c"><NumCell value={leaf.months[c.i] || 0} label={`${label}, ${MONTHS[c.i]}`} onChange={(v) => edit((l) => { l.months[c.i] = v; })} /></td>
          : <td key={i} className="n dim">{fmt0(m[c.i])}</td>)}
      {leaf.mode === 'annual' && !ro
        ? <td className="c tot"><NumCell value={leaf.annual || 0} label={`${label}, montant annuel`} onChange={(v) => edit((l) => { l.annual = v; })} /></td>
        : <td className="n tot">{fmt0(sum(m))}</td>}
    </>
  );
}

const ModeBtn = ({ mode, onClick, ro }: { mode: Mode; onClick: () => void; ro: boolean }) => (
  <button type="button" className={'bd-mode ' + mode} disabled={ro} onClick={onClick}
    title={mode === 'annual' ? 'Montant annuel réparti sur 12 mois : cliquez pour saisir mois par mois' : 'Saisie mois par mois : cliquez pour saisir un montant annuel'}>{mode === 'annual' ? 'An' : '12 m'}</button>
);

type AccProps = { sec: Sec; acc: Acc; entry: Entry | undefined; hist: Record<number, number> | undefined; open: boolean; histOpen: boolean; ro: boolean; onEdit: EditFn; onToggle: (k: string) => void };

const AccountRows = memo(function AccountRows({ sec, acc, entry, hist, open, histOpen, ro, onEdit, onToggle }: AccProps) {
  const [k, code, label] = acc;
  const e = entry || emptyEntry();
  const subs = e.subs || [];
  const months = accMonths(e);
  const hasSubs = subs.length > 0;
  const h = HIST_YEARS.map((y) => (hist ? hist[y] : undefined));
  const [newLabel, setNewLabel] = useState('');
  const [pct, setPct] = useState('');
  const [basis, setBasis] = useState<'current' | 'hist' | 'chain'>('current');
  const presets = sec.k === 's70' ? ['Vente particulier', 'Vente Horeca', 'Grande Distribution', 'Événements'] : sec.k === 's62' ? ['Brasseur 1', 'Commercial Horeca', 'Étudiants', 'Gérant'] : [];
  const addSub = (lbl: string) => {
    const t = lbl.trim(); if (!t) return;
    onEdit(k, (en) => {
      if (!en.subs.length && (en.annual || sum(en.months))) { // le montant existant devient une première sous-ligne : le total ne change pas
        en.subs.push({ id: uid(), label: 'Autres / non ventilé', mode: en.mode, annual: en.annual, months: [...en.months] });
        en.annual = 0; en.months = Z12(); en.mode = 'annual';
      }
      en.subs.push({ id: uid(), label: t, mode: 'monthly', annual: 0, months: Z12() });
    });
    setNewLabel('');
  };
  const doPct = () => {
    const p = parseNum(pct); if (!p) return;
    onEdit(k, (en) => {
      const f = 1 + p / 100;
      const leaves: Leaf[] = en.subs.length ? en.subs : [en];
      for (const L of leaves) {
        if (basis === 'hist' && !en.subs.length) { const b = (hist ? hist[HIST_YEARS[HIST_YEARS.length - 1]] || 0 : 0) / 12; L.mode = 'monthly'; L.months = Z12().map(() => r2(b * f)); }
        else if (basis === 'chain') { const m0 = leafMonths(L)[0]; L.mode = 'monthly'; L.months = Z12().map((_, i) => r2(m0 * Math.pow(f, i))); }
        else if (L.mode === 'annual') L.annual = r2(L.annual * f); else L.months = L.months.map((x) => r2(x * f));
      }
    });
    setPct('');
  };
  const span = 2 + (histOpen ? 3 : 0) + COLS.length + 2;
  return (
    <>
      <tr className={'acc' + (open ? ' is-open' : '')}>
        <th className="lbl" scope="row">
          <button type="button" className="bd-tw" aria-expanded={open} aria-label={`Détail du compte ${code} ${label}`} onClick={() => onToggle(k)}>{open ? '▾' : '▸'}</button>
          <span className="code">{code.startsWith('x') ? '' : code}</span><span className="nm" title={label}>{label}</span>
          {hasSubs ? <span className="bd-badge" title="Total = somme des lignes de détail">{subs.length} détail{subs.length > 1 ? 's' : ''}</span> : null}
        </th>
        <td className="tools">{hasSubs ? null : <ModeBtn mode={e.mode} ro={ro} onClick={() => onEdit(k, (en) => toggleLeafMode(en))} />}</td>
        <HistCells vals={h} show={histOpen} />
        {hasSubs ? <><MonthCells months={months} /><TotalCells months={months} h25={h[2]} /></> : <><LeafCells leaf={e} ro={ro} label={`${code} ${label}`} edit={(fn) => onEdit(k, (en) => fn(en))} /><td className="n delta">{h[2] === undefined ? '' : pctTxt(sum(months), h[2])}</td></>}
      </tr>
      {open ? (
        <tr className="panel"><td colSpan={span}>
          <div className="bd-panel">
            <div className="bd-pg">
              <span className="bd-pt">Saisie</span>
              {hasSubs ? <span className="bd-hint">Le total du compte est la somme des lignes de détail ci-dessous.</span> : (
                <span className="bd-seg" role="group" aria-label="Mode de saisie">
                  <button type="button" disabled={ro} aria-pressed={e.mode === 'monthly'} onClick={() => e.mode !== 'monthly' && onEdit(k, (en) => toggleLeafMode(en))}>Mois par mois</button>
                  <button type="button" disabled={ro} aria-pressed={e.mode === 'annual'} onClick={() => e.mode !== 'annual' && onEdit(k, (en) => toggleLeafMode(en))}>Montant annuel ÷ 12</button>
                </span>)}
            </div>
            <div className="bd-pg">
              <span className="bd-pt">Variation</span>
              <input className="bd-in w70" type="text" inputMode="decimal" disabled={ro} placeholder="+5 ou −3" aria-label="Pourcentage de variation" value={pct} onChange={(ev) => setPct(ev.target.value)} />
              <span className="bd-u">%</span>
              <select disabled={ro} aria-label="Base de la variation" value={basis} onChange={(ev) => setBasis(ev.target.value as any)}>
                <option value="current">sur les montants actuels</option>
                <option value="hist">sur le réalisé {HIST_YEARS[2]} ÷ 12</option>
                <option value="chain">de mois en mois (cumulée)</option>
              </select>
              <button type="button" className="bd-btn sm" disabled={ro || !parseNum(pct)} onClick={doPct}>Appliquer</button>
            </div>
            <div className="bd-pg">
              <span className="bd-pt">Lignes de détail</span>
              <input className="bd-in wide" type="text" disabled={ro} placeholder={sec.k === 's62' ? 'ex. Brasseur 1' : sec.k === 's70' ? 'ex. Vente Horeca' : 'Nom de la ligne'} aria-label="Nom de la nouvelle ligne de détail" value={newLabel}
                onChange={(ev) => setNewLabel(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') addSub(newLabel); }} />
              <button type="button" className="bd-btn sm" disabled={ro || !newLabel.trim()} onClick={() => addSub(newLabel)}>Ajouter</button>
              {presets.map((p) => <button key={p} type="button" className="bd-chip" disabled={ro} onClick={() => addSub(p)}>+ {p}</button>)}
              {hasSubs ? <button type="button" className="bd-btn sm danger" disabled={ro} onClick={() => { if (confirm('Supprimer toutes les lignes de détail de ce compte ?')) onEdit(k, (en) => { en.subs = []; }); }}>Tout supprimer</button> : null}
            </div>
          </div>
        </td></tr>
      ) : null}
      {subs.map((s, i) => (
        <tr className="sub" key={s.id}>
          <th className="lbl" scope="row">
            <span className="indent" />
            <input className="bd-in lab" type="text" disabled={ro} aria-label={`Libellé de la ligne de détail ${i + 1} du compte ${code}`} value={s.label} onChange={(ev) => onEdit(k, (en) => { en.subs[i].label = ev.target.value; })} />
            <button type="button" className="bd-x" disabled={ro} aria-label={`Supprimer la ligne ${s.label}`} title="Supprimer cette ligne" onClick={() => onEdit(k, (en) => { en.subs.splice(i, 1); })}>×</button>
          </th>
          <td className="tools"><ModeBtn mode={s.mode} ro={ro} onClick={() => onEdit(k, (en) => toggleLeafMode(en.subs[i]))} /></td>
          <HistCells vals={[undefined, undefined, undefined]} show={histOpen} />
          <LeafCells leaf={s} ro={ro} label={`${label} : ${s.label}`} edit={(fn) => onEdit(k, (en) => fn(en.subs[i]))} />
          <td className="n delta"></td>
        </tr>
      ))}
    </>
  );
});

/* ====================================================================
   Page
   ==================================================================== */
const secAccKeys = (s: Sec) => s.groups.flatMap((g) => g.accounts.map((a) => a[0]));

export default function BudgetPage() {
  const router = useRouter();
  const routerRef = useRef(router); routerRef.current = router;
  const supabase = useMemo(() => createClient(), []);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [hist, setHist] = useState<Hist>({});
  const [canWrite, setCanWrite] = useState(false);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState({ txt: 'Chargement…', off: false });
  const [histOpen, setHistOpen] = useState(false);
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({});
  const [openGrp, setOpenGrp] = useState<Record<string, boolean>>({});
  const [openAcc, setOpenAcc] = useState<Record<string, boolean>>({});
  const [gPct, setGPct] = useState(''), [gBasis, setGBasis] = useState<'current' | 'hist' | 'chain'>('current'), [gScope, setGScope] = useState('all');
  const [conflict, setConflict] = useState(false);
  const R = useRef<{ stamp: string | null; timer: any; dirty: boolean; saving: boolean; plan: Plan | null; undo: Plan[] }>({ stamp: null, timer: null, dirty: false, saving: false, plan: null, undo: [] });
  const [undoN, setUndoN] = useState(0);
  const ro = !canWrite;

  /* ---- chargement : accès, droits, historique, plan 2026 ---- */
  const load = useCallback(async () => {
    setStatus({ txt: 'Chargement…', off: false });
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth || !auth.user) { routerRef.current.replace('/login?next=/apps/budget'); return; }
      const acc = await supabase.rpc('has_app_access', { p_route: '/apps/budget' });
      if (!acc.error && acc.data === false) { routerRef.current.replace('/dashboard'); return; }
      const w = await supabase.rpc('can_write_budget'); setCanWrite(Boolean(w.data));
      const h = await supabase.from(TABLE_HIST).select('account_key,year,amount').limit(5000);
      const p = await supabase.from(TABLE_PLAN).select('data,updated_at').eq('year', YEAR).maybeSingle();
      if (h.error || p.error) {
        const m = (h.error || p.error)!.message || '';
        setNotice(/relation|does not exist|schema cache/i.test(m) ? 'Les tables du budget n’existent pas encore : exécutez sql/02_budget_pcmn.sql dans Supabase (SQL Editor), puis rechargez la page.' : 'Chargement impossible : ' + m);
      } else setNotice('');
      const H: Hist = {};
      (h.data || []).forEach((r: any) => { (H[r.account_key] = H[r.account_key] || {})[r.year] = Number(r.amount); });
      setHist(H);
      const raw = p.data && p.data.data && p.data.data.rows ? p.data.data : { v: 1, rows: {} };
      const rows: Record<string, Entry> = {};
      Object.keys(raw.rows).forEach((k) => { rows[k] = cloneEntry(raw.rows[k]); });
      const pl: Plan = { v: 1, rows };
      R.current.plan = pl; R.current.stamp = p.data ? p.data.updated_at : null; R.current.dirty = false; R.current.undo = []; setUndoN(0); setConflict(false);
      setPlan(pl);
      setStatus({ txt: w.data ? (p.data ? 'Budget chargé' : 'Nouveau budget : enregistré à la première modification') : 'Lecture seule', off: !w.data });
    } catch (e: any) {
      setNotice('Chargement impossible : ' + (e && e.message ? e.message : 'erreur réseau'));
      setStatus({ txt: 'Hors ligne', off: true });
    }
    setReady(true);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  /* ---- enregistrement différé ---- */
  const save = useCallback(async () => {
    const r = R.current;
    if (!r.plan || !r.dirty || r.saving) return;
    r.saving = true; setStatus({ txt: 'Enregistrement…', off: false });
    const snapshot = r.plan;
    try {
      let res: any;
      if (r.stamp) res = await supabase.from(TABLE_PLAN).update({ data: snapshot }).eq('year', YEAR).eq('updated_at', r.stamp).select('updated_at');
      else res = await supabase.from(TABLE_PLAN).insert({ year: YEAR, data: snapshot }).select('updated_at');
      if (res.error) {
        if (res.error.code === '23505') { setConflict(true); setStatus({ txt: 'Conflit : budget modifié ailleurs', off: true }); }
        else throw res.error;
      } else if (!res.data || !res.data.length) { setConflict(true); setStatus({ txt: 'Conflit : budget modifié ailleurs', off: true }); }
      else {
        r.stamp = res.data[0].updated_at; r.dirty = r.plan !== snapshot;
        setStatus({ txt: r.dirty ? 'Modifications à enregistrer…' : 'Enregistré à ' + new Date().toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }), off: false });
        if (r.dirty) { clearTimeout(r.timer); r.timer = setTimeout(save, 600); }
      }
    } catch (e: any) { setStatus({ txt: 'Enregistrement impossible', off: true }); setNotice('Enregistrement impossible : ' + (e && e.message ? e.message : 'erreur réseau')); }
    r.saving = false;
  }, [supabase]);
  const commit = useCallback((next: Plan, pushUndo?: Plan) => {
    const r = R.current;
    if (pushUndo) { r.undo.push(pushUndo); if (r.undo.length > 15) r.undo.shift(); setUndoN(r.undo.length); }
    r.plan = next; r.dirty = true; setPlan(next);
    setStatus({ txt: 'Modifications à enregistrer…', off: false });
    clearTimeout(r.timer); r.timer = setTimeout(save, 1200);
  }, [save]);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (R.current.dirty && !conflict) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('beforeunload', onUnload); clearTimeout(R.current.timer); };
  }, [conflict]);

  const onEdit: EditFn = useCallback((key, fn) => {
    const r = R.current; if (!r.plan || ro) return;
    const e = cloneEntry(r.plan.rows[key]); fn(e);
    commit({ ...r.plan, rows: { ...r.plan.rows, [key]: e } });
  }, [commit, ro]);
  const toggleAcc = useCallback((k: string) => setOpenAcc((o) => ({ ...o, [k]: !o[k] })), []);

  /* ---- calculs ---- */
  const calc = useMemo(() => {
    const rows = plan ? plan.rows : {};
    const accM: Record<string, number[]> = {}, secM: Record<string, number[]> = {}, grpM: Record<string, number[]> = {};
    const secH: Record<string, number[]> = {}, grpH: Record<string, number[]> = {};
    CHART.forEach((s) => {
      secM[s.k] = Z12(); secH[s.k] = [0, 0, 0];
      s.groups.forEach((g, gi) => {
        const gk = s.k + ':' + gi; grpM[gk] = Z12(); grpH[gk] = [0, 0, 0];
        g.accounts.forEach((a) => {
          const m = accMonths(rows[a[0]]); accM[a[0]] = m; addTo(grpM[gk], m);
          HIST_YEARS.forEach((y, i) => { grpH[gk][i] += (hist[a[0]] || {})[y] || 0; });
        });
        addTo(secM[s.k], grpM[gk]); addTo(secH[s.k], grpH[gk]);
      });
    });
    return { accM, secM, grpM, secH, grpH, resM: results(secM, 12), resH: results(secH, 3) };
  }, [plan, hist]);

  const kpi = (key: string) => {
    const t = key === 'ca' ? sum(calc.secM.s70) : sum(calc.resM[key]);
    const h = key === 'ca' ? calc.secH.s70[2] : calc.resH[key][2];
    return { t, h };
  };

  /* ---- actions globales ---- */
  const applyGlobalPct = () => {
    const p = parseNum(gPct); const r = R.current; if (!p || !r.plan || ro) return;
    const keys = gScope === 'all' ? CHART.flatMap(secAccKeys) : secAccKeys(CHART.find((s) => s.k === gScope)!);
    commit(applyPct(r.plan, keys, p, gBasis, hist), r.plan); setGPct('');
  };
  const undo = () => { const r = R.current; const prev = r.undo.pop(); setUndoN(r.undo.length); if (prev) commit(prev); };
  const setAll = (open: boolean) => { const o: Record<string, boolean> = {}; CHART.forEach((s) => { o[s.k] = open; s.groups.forEach((_, gi) => { o[s.k + ':' + gi] = open; }); }); setOpenSec(o); setOpenGrp(o); if (!open) setOpenAcc({}); };
  const exportCsv = () => {
    const q = (v: any) => { if (typeof v === 'number') return isFinite(v) ? String(r2(v)).replace('.', ',') : ''; const t = String(v == null ? '' : v); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const head = ['Code', 'Libellé', ...HIST_YEARS.map(String), ...COLS.map((c) => (c.t === 'm' ? MONTHS[c.i] : 'T' + (c.i + 1))), 'Total ' + YEAR];
    const out: any[][] = [head];
    const line = (code: string, label: string, h: (number | undefined)[], m: number[]) => out.push([code, label, ...h.map((x) => (x === undefined ? '' : x)), ...COLS.map((c) => colVal(m, c)), sum(m)]);
    CHART.forEach((s) => {
      line(s.code, s.label, calc.secH[s.k], calc.secM[s.k]);
      s.groups.forEach((g) => g.accounts.forEach((a) => {
        const e = plan && plan.rows[a[0]];
        line(a[1], '   ' + a[2], HIST_YEARS.map((y) => (hist[a[0]] || {})[y]), calc.accM[a[0]]);
        if (e) e.subs.forEach((sb) => line('', '      ' + sb.label, [undefined, undefined, undefined], leafMonths(sb)));
      }));
      (RES_AFTER[s.k] || []).forEach((rk) => line('', RES_LABEL[rk], calc.resH[rk], calc.resM[rk]));
    });
    const blob = new Blob(['﻿' + out.map((r) => r.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `budget-${YEAR}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  /* ---- rendu ---- */
  const span = 2 + (histOpen ? 3 : 0) + COLS.length + 2;
  const ResRow = ({ rk }: { rk: string }) => {
    const m = calc.resM[rk], h = calc.resH[rk];
    return (
      <tr className={'res res-' + rk}>
        <th className="lbl" scope="row" title={RES_HINT[rk]}><span className="nm">{RES_LABEL[rk]}</span></th>
        <td className="tools"></td>
        {histOpen ? h.map((v, i) => <td key={i} className={'n hist' + (v < 0 ? ' neg' : '')}>{fmt0(v)}</td>) : null}
        {COLS.map((c, i) => { const v = colVal(m, c); return <td key={i} className={'n ' + (c.t === 'q' ? 'q ' : '') + (v < -0.5 ? 'neg' : '')}>{fmt0(v)}</td>; })}
        <td className={'n tot' + (sum(m) < -0.5 ? ' neg' : '')}>{fmt0(sum(m))}</td><td className="n delta">{pctTxt(sum(m), h[2])}</td>
      </tr>
    );
  };
  const kpis: [string, string, string][] = [['ca', "Chiffre d'affaires", 'Classe 70'], ['mb', 'Marge brute', RES_HINT.mb], ['ebitda', 'EBITDA', RES_HINT.ebitda], ['re', "Résultat d'exploitation", RES_HINT.re], ['net', 'Résultat net', RES_HINT.net]];

  const right = (
    <>
      <span className={'site-state' + (status.off ? ' off' : '')} role="status"><span className="dot" /><span>{status.txt}</span></span>
      <span className="site-role" title="Année budgétaire">Budget {YEAR}</span>
    </>
  );

  return (
    <>
      <AppHeader title="Budget prévisionnel" right={right} />
      <style dangerouslySetInnerHTML={{ __html: BD_CSS }} />
      <div className="bd-root">
        <main className="bd-wrap">
          {notice ? <div className="bd-alert" role="alert">{notice}</div> : null}
          {conflict ? <div className="bd-alert" role="alert">Ce budget a été modifié par quelqu’un d’autre depuis votre ouverture. <button type="button" className="bd-btn sm" onClick={() => load()}>Recharger la version enregistrée</button> (vos modifications non enregistrées seront perdues).</div> : null}
          {!ready ? <p className="bd-loading">Chargement du budget…</p> : (
            <>
              <section className="bd-kpis" aria-label="Indicateurs du budget">
                {kpis.map(([k, label, hint]) => { const { t, h } = kpi(k); return (
                  <div className="bd-kpi" key={k} title={hint}>
                    <div className="l">{label}</div>
                    <div className={'v' + (t < -0.5 ? ' neg' : '')}>{eur0(t)}</div>
                    <div className="s">{HIST_YEARS[2]} : {eur0(h)} · {pctTxt(t, h)}</div>
                  </div>); })}
              </section>

              <section className="bd-bar" aria-label="Outils du budget">
                <button type="button" className="bd-btn" aria-pressed={histOpen} onClick={() => setHistOpen((v) => !v)}>{histOpen ? '▾' : '▸'} Historique {HIST_YEARS[0]}-{HIST_YEARS[2]}</button>
                <button type="button" className="bd-btn" onClick={() => setAll(true)}>Tout déplier</button>
                <button type="button" className="bd-btn" onClick={() => setAll(false)}>Tout replier</button>
                <span className="bd-sep" />
                <label className="bd-lbl" htmlFor="g-pct">Variation en %</label>
                <input id="g-pct" className="bd-in w70" type="text" inputMode="decimal" disabled={ro} placeholder="+5 ou −3" value={gPct} onChange={(e) => setGPct(e.target.value)} />
                <select disabled={ro} aria-label="Lignes concernées" value={gScope} onChange={(e) => setGScope(e.target.value)}>
                  <option value="all">Tout le budget</option>
                  {CHART.map((s) => <option key={s.k} value={s.k}>{(s.code ? s.code + ' · ' : '') + s.label}</option>)}
                </select>
                <select disabled={ro} aria-label="Base de la variation" value={gBasis} onChange={(e) => setGBasis(e.target.value as any)}>
                  <option value="current">sur les montants actuels</option>
                  <option value="hist">sur le réalisé {HIST_YEARS[2]} ÷ 12</option>
                  <option value="chain">de mois en mois (cumulée)</option>
                </select>
                <button type="button" className="bd-btn primary" disabled={ro || !parseNum(gPct)} onClick={applyGlobalPct}>Appliquer</button>
                <button type="button" className="bd-btn" disabled={ro || !undoN} onClick={undo} title="Annule la dernière variation en %">↶ Annuler</button>
                <span className="bd-sep" />
                <button type="button" className="bd-btn" onClick={exportCsv}>Exporter en CSV</button>
              </section>
              {ro ? <p className="bd-hint">Lecture seule : votre rôle ne permet pas de modifier le budget.</p> : <p className="bd-hint">Saisissez directement dans les cellules (mois par mois) ou cliquez sur « An » pour entrer un montant annuel réparti sur 12 mois. Ouvrez un compte (▸) pour la variation en % et les lignes de détail. Montants en € HTVA.</p>}

              <div className="bd-scroll">
                <table className="bd-tbl">
                  <thead>
                    <tr>
                      <th className="lbl" scope="col">Compte</th><th className="tools" scope="col"></th>
                      {histOpen ? HIST_YEARS.map((y) => <th key={y} className="n hist" scope="col">{y}<span>réalisé</span></th>) : null}
                      {COLS.map((c, i) => <th key={i} className={'n ' + (c.t === 'q' ? 'q' : '')} scope="col">{c.t === 'm' ? MONTHS[c.i] : 'T' + (c.i + 1)}</th>)}
                      <th className="n tot" scope="col">Total {YEAR}</th><th className="n delta" scope="col">vs {HIST_YEARS[2]}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CHART.map((s) => {
                      const open = !!openSec[s.k];
                      return (
                        <React.Fragment key={s.k}>
                          <tr className={'sec kind-' + s.kind}>
                            <th className="lbl" scope="row">
                              <button type="button" className="bd-tw" aria-expanded={open} aria-label={`${open ? 'Replier' : 'Déplier'} ${s.label}`} onClick={() => setOpenSec((o) => ({ ...o, [s.k]: !o[s.k] }))}>{open ? '▾' : '▸'}</button>
                              <span className="code">{s.code}</span><span className="nm">{s.label}</span>
                            </th>
                            <td className="tools"></td>
                            <HistCells vals={calc.secH[s.k]} show={histOpen} />
                            <MonthCells months={calc.secM[s.k]} />
                            <TotalCells months={calc.secM[s.k]} h25={calc.secH[s.k][2]} />
                          </tr>
                          {open ? s.groups.map((g, gi) => {
                            const gk = s.k + ':' + gi, multi = s.groups.length > 1;
                            const gOpen = !multi || !!openGrp[gk];
                            return (
                              <React.Fragment key={gk}>
                                {multi ? (
                                  <tr className="grp">
                                    <th className="lbl" scope="row">
                                      <button type="button" className="bd-tw" aria-expanded={gOpen} aria-label={`${gOpen ? 'Replier' : 'Déplier'} ${g.label}`} onClick={() => setOpenGrp((o) => ({ ...o, [gk]: !o[gk] }))}>{gOpen ? '▾' : '▸'}</button>
                                      <span className="nm">{g.label}</span>
                                    </th>
                                    <td className="tools"></td>
                                    <HistCells vals={calc.grpH[gk]} show={histOpen} />
                                    <MonthCells months={calc.grpM[gk]} />
                                    <TotalCells months={calc.grpM[gk]} h25={calc.grpH[gk][2]} />
                                  </tr>
                                ) : null}
                                {gOpen ? g.accounts.map((a) => (
                                  <AccountRows key={a[0]} sec={s} acc={a} entry={plan ? plan.rows[a[0]] : undefined} hist={hist[a[0]]} open={!!openAcc[a[0]]} histOpen={histOpen} ro={ro} onEdit={onEdit} onToggle={toggleAcc} />
                                )) : null}
                                {gOpen && !g.accounts.length ? <tr><td colSpan={span} className="bd-hint">Aucun compte.</td></tr> : null}
                              </React.Fragment>
                            );
                          }) : null}
                          {(RES_AFTER[s.k] || []).map((rk) => <ResRow key={rk} rk={rk} />)}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="bd-hint">Les totaux des trimestres (T1 à T4), les sous-totaux et les résultats sont recalculés en temps réel avec les formules du fichier « creation budjet.xlsx ». Historique : réalisé 2023, 2024 et 2025 du même fichier (lecture seule).</p>
            </>
          )}
        </main>
      </div>
    </>
  );
}

const BD_CSS = `.bd-root{background:var(--bg);color:var(--ink);font-family:var(--font-body,'IBM Plex Sans',sans-serif);min-height:calc(100vh - 90px)}
.bd-wrap{max-width:1680px;margin:0 auto;padding:16px}
.bd-loading{padding:60px 16px;text-align:center;color:var(--muted)}
.bd-alert{background:var(--accent-soft);border:1px solid var(--accent);border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:14px}
.bd-kpis{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));margin-bottom:14px}
.bd-kpi{background:var(--surface);border:1px solid var(--line);border-top:3px solid var(--accent);border-radius:6px;padding:12px 14px;min-width:0}
.bd-kpi .l{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600}
.bd-kpi .v{font-family:var(--font-mono,'IBM Plex Mono',monospace);font-size:22px;font-weight:600;margin-top:4px;font-variant-numeric:tabular-nums;white-space:nowrap}
.bd-kpi .s{font-family:var(--font-mono,'IBM Plex Mono',monospace);font-size:12px;color:var(--muted);margin-top:2px}
.neg{color:#9B2C1F!important}
.bd-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
.bd-sep{width:1px;height:24px;background:var(--line);margin:0 4px}
.bd-lbl{font-size:12px;color:var(--muted);font-weight:600}
.bd-hint{font-size:12px;color:var(--muted);margin:6px 0}
.bd-btn{appearance:none;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:4px;height:32px;padding:0 12px;cursor:pointer;font:inherit;font-size:13px;white-space:nowrap}
.bd-btn:hover:not(:disabled){border-color:var(--muted)}
.bd-btn.sm{height:28px;padding:0 10px;font-size:12px}
.bd-btn.primary{background:var(--brand-2);border-color:var(--brand-2);color:var(--brand);font-weight:600}
.bd-btn.danger{color:#9B2C1F}
.bd-btn[aria-pressed=true]{background:var(--accent-soft);border-color:var(--brand-2)}
.bd-btn:disabled,.bd-in:disabled,.bd-mode:disabled,.bd-chip:disabled{opacity:.55;cursor:not-allowed}
.bd-btn:focus-visible,.bd-in:focus-visible,.bd-tw:focus-visible,.bd-mode:focus-visible{outline:2px solid var(--brand-2);outline-offset:1px}
.bd-root select{height:32px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);padding:0 8px;font:inherit;font-size:13px;max-width:100%}
.bd-in{height:28px;border:1px solid transparent;border-radius:3px;background:transparent;color:var(--ink);width:100%;min-width:0;padding:0 6px;text-align:right;font-family:var(--font-mono,'IBM Plex Mono',monospace);font-size:12.5px;font-variant-numeric:tabular-nums}
.bd-in:hover:not(:disabled){border-color:var(--line);background:var(--surface)}
.bd-in:focus{border-color:var(--brand-2);background:var(--surface);outline:none}
.bd-in.w70{width:78px;height:30px;border-color:var(--line);background:var(--surface)}
.bd-in.wide{width:220px;text-align:left;height:30px;border-color:var(--line);background:var(--surface);font-family:inherit;font-size:13px}
.bd-in.lab{text-align:left;font-family:inherit;font-size:13px;flex:1 1 auto;border-color:var(--line);background:var(--surface)}
.bd-scroll{overflow:auto;max-height:calc(100vh - var(--hh,90px) - 20px);background:var(--surface);border:1px solid var(--line);border-radius:6px}
.bd-tbl{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;font-size:13px}
.bd-tbl th,.bd-tbl td{border-bottom:1px solid var(--line);padding:0 8px;height:32px;white-space:nowrap}
.bd-tbl thead th{position:sticky;top:0;z-index:3;background:var(--brand);color:#fff;font-weight:600;font-size:12px;text-align:right;height:36px;border-bottom:2px solid var(--brand-2)}
.bd-tbl thead th span{display:block;font-weight:400;font-size:10px;opacity:.75;margin-top:-2px}
.bd-tbl .lbl{position:sticky;left:0;z-index:2;background:var(--surface);text-align:left;min-width:360px;max-width:360px;width:360px;overflow:hidden;text-overflow:ellipsis;font-weight:400;border-right:1px solid var(--line)}
.bd-tbl thead .lbl{z-index:4;background:var(--brand);text-align:left}
.bd-tbl .tools{position:sticky;left:360px;z-index:2;background:var(--surface);min-width:56px;width:56px;max-width:56px;text-align:center;padding:0 4px;border-right:1px solid var(--line)}
.bd-tbl thead .tools{z-index:4;background:var(--brand)}
.bd-tbl td.n,.bd-tbl th.n{text-align:right;font-family:var(--font-mono,'IBM Plex Mono',monospace);font-variant-numeric:tabular-nums;min-width:74px}
.bd-tbl thead th.n{font-family:inherit}
.bd-tbl td.c{padding:0 2px;min-width:78px}
.bd-tbl td.q,.bd-tbl th.q{background:var(--surface-2);font-weight:600}
.bd-tbl thead th.q{background:#0F3A4C}
.bd-tbl td.tot,.bd-tbl th.tot{background:var(--accent-soft);font-weight:600;min-width:96px}
.bd-tbl thead th.tot{background:var(--brand-2);color:var(--brand)}
.bd-tbl td.delta,.bd-tbl th.delta{color:var(--muted);min-width:70px;font-size:12px}
.bd-tbl td.hist,.bd-tbl th.hist{background:#F4F5EE;color:var(--muted);min-width:84px}
.bd-tbl thead th.hist{background:#3C5865;color:#fff}
.bd-tbl td.dim{color:var(--muted)}
.bd-tbl tr.sec th,.bd-tbl tr.sec td{background:var(--surface-2);font-weight:600;border-top:1px solid var(--line)}
.bd-tbl tr.sec td.q{background:#E0E5D6}
.bd-tbl tr.sec td.tot{background:#F2E3A0}
.bd-tbl tr.sec td.hist{background:#E6EADD}
.bd-tbl tr.grp th,.bd-tbl tr.grp td{background:#F6F7F1;font-weight:600;font-style:italic}
.bd-tbl tr.grp th .nm{padding-left:14px}
.bd-tbl tr.acc th .nm{padding-left:4px}
.bd-tbl tr.acc:hover th,.bd-tbl tr.acc:hover td.tools{background:#FBFBF7}
.bd-tbl tr.res th,.bd-tbl tr.res td{background:var(--brand);color:#fff;font-weight:600;border-bottom:1px solid var(--brand)}
.bd-tbl tr.res td.q,.bd-tbl tr.res td.tot,.bd-tbl tr.res td.hist{background:#0F3A4C;color:#fff}
.bd-tbl tr.res td.delta{color:rgba(255,255,255,.75)}
.bd-tbl tr.res td.neg,.bd-tbl tr.res td.neg{color:#FFB4A8!important}
.bd-tbl tr.res-ebitda th,.bd-tbl tr.res-ebitda td,.bd-tbl tr.res-cash th,.bd-tbl tr.res-cash td{background:#27495A;font-weight:500}
.bd-tbl tr.sub th,.bd-tbl tr.sub td{background:#FFFEF6}
.bd-tbl tr.sub .lbl{display:flex;align-items:center;gap:6px;padding-left:36px;height:32px}
.bd-tbl tr.sub .tools{background:#FFFEF6}
.bd-tbl tr.sub td.q{background:#F6F2DA}
.bd-tbl .indent{display:none}
.bd-tbl .code{font-family:var(--font-mono,'IBM Plex Mono',monospace);font-size:11.5px;color:var(--muted);margin:0 8px 0 2px}
.bd-tbl tr.res .nm,.bd-tbl tr.res .code{color:#fff}
.bd-tbl tr.sec .code{color:var(--accent-text,#7A6100)}
.bd-tbl .lbl .nm{overflow:hidden;text-overflow:ellipsis}
.bd-tbl tr.acc .lbl,.bd-tbl tr.sec .lbl,.bd-tbl tr.grp .lbl{display:flex;align-items:center}
.bd-tw{appearance:none;border:0;background:transparent;color:var(--muted);cursor:pointer;width:22px;height:22px;flex:0 0 auto;font-size:12px;border-radius:3px}
.bd-tw:hover{background:var(--accent-soft);color:var(--ink)}
.bd-badge{margin-left:8px;font-size:10.5px;background:var(--accent-soft);color:var(--accent-text,#7A6100);border-radius:999px;padding:1px 7px;flex:0 0 auto}
.bd-mode{appearance:none;border:1px solid var(--line);background:var(--surface);border-radius:999px;font-size:10.5px;font-weight:600;height:22px;min-width:38px;cursor:pointer;color:var(--muted)}
.bd-mode.annual{background:var(--accent-soft);color:var(--accent-text,#7A6100);border-color:var(--brand-2)}
.bd-x{appearance:none;border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:16px;width:24px;height:24px;border-radius:3px;flex:0 0 auto}
.bd-x:hover:not(:disabled){background:#F7DAD3;color:#9B2C1F}
.bd-tbl tr.panel td{background:#FAF8EC;padding:0;height:auto;white-space:normal}
.bd-panel{position:sticky;left:0;width:min(calc(100vw - 48px),980px);padding:10px 14px 12px 38px;display:flex;flex-direction:column;gap:8px}
.bd-pg{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.bd-pt{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600;min-width:96px}
.bd-u{color:var(--muted);font-size:13px}
.bd-seg{display:inline-flex;border:1px solid var(--line);border-radius:4px;overflow:hidden}
.bd-seg button{appearance:none;border:0;background:var(--surface);height:30px;padding:0 12px;cursor:pointer;font:inherit;font-size:13px;color:var(--ink)}
.bd-seg button[aria-pressed=true]{background:var(--accent-soft);font-weight:600}
.bd-chip{appearance:none;border:1px dashed var(--muted);background:transparent;border-radius:999px;height:28px;padding:0 10px;font:inherit;font-size:12px;cursor:pointer;color:var(--ink)}
.bd-chip:hover:not(:disabled){background:var(--accent-soft);border-color:var(--brand-2)}
@media (max-width:640px){
  .bd-wrap{padding:12px}
  .bd-tbl .lbl{min-width:200px;max-width:200px;width:200px}
  .bd-tbl .tools{left:200px}
  .bd-panel{width:calc(100vw - 40px);padding-left:12px}
  .bd-in.wide{width:100%}
  .bd-kpi .v{font-size:18px}
  .bd-kpis{grid-template-columns:1fr 1fr}
}
`;
