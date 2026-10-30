// lib/pcmn.ts : plan comptable (PCMN) du budget, formules de résultats et utilitaires partagés
// par les applications Budget et Analyse. Aucune dépendance : fonctions pures.

export type Mode = 'annual' | 'monthly';
export type Leaf = { mode: Mode; annual: number; months: number[] };
export type Sub = Leaf & { id: string; label: string; comment?: string };
export type Entry = Leaf & { subs: Sub[]; comment?: string };
export type Plan = { v: 1; rows: Record<string, Entry> };
export type Acc = [string, string, string]; // clé, code, libellé
export type Sec = { k: string; code: string; label: string; kind: 'rev' | 'cost' | 'net'; groups: { label: string | null; accounts: Acc[] }[] };
export type Hist = Record<string, Record<number, number>>;

export const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avril', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
export const MONTHS_LONG = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export const CHART: Sec[] = [{"k":"s70","code":"70","label":"Chiffre d'affaires","kind":"rev","groups":[{"label":null,"accounts":[["700100","700100","Ventes (compte à ne plus utiliser)"],["700000","700000","Ventes en Belgique (marchandises)"],["700110","700110","Ventes de produits à Façon"],["701000","701000","Ventes en Belgique (produits finis)"],["701100","701100","Ventes dans les pays membres de la C.E.E. (produits finis)"],["700300","700300","Ventes diverses"],["700400","700400","Ventes lors d'événements"],["700600","700600","Ventes de Packaging"],["708800","708800","Echantillons pour clients"],["703000","703000","Locations à caractère Professionnel"]]}]},{"k":"s74","code":"74","label":"Autres produits","kind":"rev","groups":[{"label":null,"accounts":[["743100","743100","Frais de livraison"],["743110","743110","Revente de matériel"],["743130","743130","Refacturation de prestations"],["743150","743150","Refac. mat. premières & bouteilles vides"]]}]},{"k":"s60","code":"60","label":"Approvisionnements, marchandises","kind":"cost","groups":[{"label":null,"accounts":[["600000","600000","Achats de matières premières"],["600004","600004","Emballages - leasing de fûts"],["600005","600005","Emballages - bouteilles et étiquettes"],["600006","600006","Nettoyage d'emballages réutilisables"],["600007","600007","Bonbonne CO2"],["600008","600008","Emballages - autres packaging"],["600009","600009","Achats pour tests"],["600010","600010","Accises"],["600015","600015","FostPlus"],["600016","600016","Emballages - cannettes"],["601000","601000","Achats de fournitures"],["601700","601700","Fournitures diverses et petit outillage"],["613050","613050","Frais de livraisons des fournisseurs"],["613055","613055","Frais de livraisons clients"],["602000","602000","Frais d'analyse, frais de laboratoire"],["603020","603020","Sous-traitant Encannage"],["603000","603000","Sous-traitances générales"],["603010","603010","Sous-traitant maintenance"],["603021","603021","Sous-traitant (aide) soutirage"],["603030","603030","Sous-traitant autres prestations"],["603040","603040","Sous-traitant gestion de projets"],["603050","603050","km remboursés aux sous-traitants"],["604000","604000","Achats pour événements"],["615220","615220","Participation foires, expo., …"],["613000","613000","Commissions Summer Beer Lovers Festival"],["604005","604005","Achats pour événement - Court Circuit"],["604040","604040","Achats de marchandises : verres Badjawe, ..."],["605000","605000","Echantillons pour analyses , concours"],["609000","609000","Variation des stocks matières premières"],["609100","609100","Variation des stocks fournitures"],["609200","609200","Variation des stocks produits en cours"],["609400","609400","Variation des stocks produits en cours"],["609800","609800","Variation - échantillons"],["710200","710200","Variation des stocks produits en cours de fabrication"],["710000","710000","Variation des stocks produits finis"]]}]},{"k":"nrj","code":"","label":"Énergie et eau","kind":"cost","groups":[{"label":null,"accounts":[["611120","611120","Charges bâtiment Alleur"],["612110","612110","Gaz"],["612120","612120","Electricité"],["612200","612200","Produits d'entretien"]]}]},{"k":"s7174","code":"71;74","label":"Autres produits d'exploitation","kind":"rev","groups":[{"label":null,"accounts":[["740000","740000","Facturation Terravia"],["740010","740010","Remboursement par assurance"],["740020","740020","Indemnisation reçue"],["740040","740040","Autres subsides"],["742010","742010","Régularisation clients et fournisseurs"],["746000","746000","Produits d'exploitation divers"]]}]},{"k":"vin","code":"","label":"Vinaigrerie (solde net)","kind":"net","groups":[{"label":null,"accounts":[["x80","","Vente de vinaigre GoCircular"],["740030","740030","Subsides GoCircular (70% des dépenses)"],["740060","740060","Subsides GoCircular Invest (70% des dépenses)"],["613230","613230","Prestations informatiques"],["602010","602010","Achats et prestations pour GoCircular (100%)"],["613220","613220","Prestations production"],["630240","630240","Dot. Amort. s/investissements vinaigrerie"],["x87","","Autres frais"],["x88","","Prestations"],["x89","","trft vinaigrerie subside"],["x90","","trft vinaigrerie frais de bureau"],["x91","","trft vinaigrerie AFSCA"],["x92","","trft vinaigrerie support"],["x93","","trft vinaigrerie honoraires"],["x94","","trft vinaigrerie rému"],["612000","612000","Compte 612000"]]}]},{"k":"s61","code":"61","label":"Services et biens divers","kind":"cost","groups":[{"label":"Locaux et charges","accounts":[["611100","611100","Loyers bâtiment à Alleur"],["611200","611200","Prestations de nettoyage"],["611410","611410","Entretien et rép. - Constructions"],["611520","611520","Entretien et rép. - matériel"],["611530","611530","Entretien et rép. matériel de service mobile (pompe mis à disposition) (ne plus utiliser)"],["611000","611000","Entretien et réparation"]]},{"label":"Déplacements","accounts":[["615100","615100","Déplacements : NDF, parking, etc."],["614002","614002","Entretiens et réparations véhicules"],["614003","614003","Assurances véhicules"],["614004","614004","Carburant"],["614005","614005","Parking"],["614010","614010","Location matériel"]]},{"label":"Frais de bureau","accounts":[["612420","612420","Fournitures de bureau diverses"],["612500","612500","Téléphone"],["612510","612510","GSM"],["612520","612520","Internet, site, hébergement, mail box"],["612530","612530","Licences informatiques"],["612550","612550","Frais postaux"]]},{"label":"Assurances","accounts":[["613500","613500","Assurance incendie et frais généraux"],["613510","613510","Assurance contre le vol"],["613530","613530","Assurance responsabilité civile"]]},{"label":"Honoraires experts et comptabilité","accounts":[["615300","615300","Frais de dépôts cptes annuels"],["615310","615310","publication au Moniteur Belge"],["613240","613240","Prestations admin et financières"],["613241","613241","Prestations Gestion RH"],["613250","613250","Prestations suport admin"],["613260","613260","Expert-comptable"]]},{"label":"Frais de communication et relations clients","accounts":[["614000","614000","Frais de circonstances (fleurs)"],["615110","615110","Frais de circonstances (fleurs)"],["615120","615120","Participation à des cours, …"],["615150","615150","Frais de réception, réunion"],["615240","615240","Objets publicitaires / marketing"],["615260","615260","Objets publicitaires / gob réutilisables"],["615270","615270","Sponsoring (avec ventes en contre-partie)"]]},{"label":"Frais spécifiques à l'activité","accounts":[["613310","613310","Certification bio"],["615400","615400","Cotisations AFSCA"],["615410","615410","Cotisations déchets"],["615420","615420","Cotisations groupement professionnels"],["615450","615450","Frais pour événements BtoB"],["615140","615140","Frais de R&D, documentation"],["612430","612430","Petit matériel"],["613280","613280","Prestation bar"],["613051","613051","Stockage de palettes avant livraison"],["613270","613270","Prestations support / gestion des commandes"]]}]},{"k":"pext","code":"","label":"Personnel externe","kind":"cost","groups":[{"label":null,"accounts":[["613210","613210","Avocats"],["613245","613245","Consultances"],["613290","613290","Autres experts"],["613100","613100","Honoraires divers"]]}]},{"k":"s62","code":"62","label":"Rémunérations, charges sociales et pensions","kind":"cost","groups":[{"label":null,"accounts":[["620201","620201","Rémunérations employés"],["620202","620202","Rémunérations employés (JF/non presté/récup)"],["620203","620203","Rémunérations employés (congés payés)"],["620204","620204","Rémunérations employés (double pécule)"],["625020","625020","Dotation provision PV - employés"],["625120","625120","Util. / reprise provision PV - employés"],["620205","620205","Rémunérations employés (PFA/primes)"],["620221","620221","Rémunérations employés / ATN GSM"],["620222","620222","Rémunérations employés / ATN abon.GSM"],["620223","620223","Rémunérations employés / ATN internet mobile"],["740221","740221","Récupération ATN GSM"],["740222","740222","Récupération ATN abon.GSM"],["740223","740223","Récupération ATN internet mobile"],["740050","740050","Plan SESAM"],["621020","621020","Cotisations ONSS sur salaires - employés"],["621900","621900","Redistribution charges ONSS"],["749030","749030","Réductions charges sociales"],["749050","749050","Réduction Précompte"],["620301","620301","Rémunérations ouvriers (heures prestées)"],["620302","620302","Rémunérations ouvriers (JF/non presté/récup)"],["620303","620303","Rémunérations ouvriers (pécule vacances)"],["620306","620306","Rémunérations ouvriers (maladie)"],["625030","625030","Dotation provision PV - ouvriers"],["625130","625130","Util. / reprise provisions PV - ouvriers"],["621030","621030","Cotisations ONSS sur salaires - ouvriers"],["623100","623100","Frais de déplacement"],["623210","623210","Chèque-repas"],["623211","623211","Chèque-repas déductibles"],["749100","749100","Chèques-repas - part travailleur"],["623240","623240","Ecochèques"],["613330","613330","Prestations Edenred"],["623220","623220","Frais de cantine"],["623230","623230","Vêtements de travail"],["623250","623250","Participation assurance soins de santé"],["623260","623260","Participation assurance groupe"],["623270","623270","Remboursement frais de représentation"],["623280","623280","Remboursement forfait télétravail"],["623000","623000","Assurance-loi, RC & chemin du travail"],["623200","623200","Service médical, médecine du travail"],["613300","613300","Secrétariat social (fixe)"],["613301","613301","Secrétariat social (variable)"],["749040","749040","Intervention frais secrétariat social"],["616700","616700","Restaurants + repas annuel d'équipe"]]}]},{"k":"s630","code":"630","label":"Amortissements sur immobilisations","kind":"cost","groups":[{"label":null,"accounts":[["630220","630220","Dot. Amort. s/install., mach., outillage"],["630230","630230","Dot. Amort. s/ mobilier et mat. Roulant"],["630200","630200","Dotations aux amortissements sur immobilisations corporelles"]]}]},{"k":"s631","code":"631;634","label":"Réductions de valeur sur stocks et créances","kind":"cost","groups":[{"label":null,"accounts":[["634000","634000","Réductions de valeur sur créances"]]}]},{"k":"s635","code":"635;637","label":"Provisions pour risques et charges","kind":"cost","groups":[]},{"k":"s640","code":"640","label":"Autres charges d'exploitation","kind":"cost","groups":[{"label":null,"accounts":[["640010","640010","Cotisation des sociétés"],["640040","640040","Taxe de circulation - Utilitaires"],["640050","640050","Précompte immobilier"],["640120","640120","TVA non déductible"],["640250","640250","Taxes sur l'environnement"],["640800","640800","Pertes sur stock / défauts"],["640700","640700","Autres charges d'exploitation"],["642010","642010","Régularisation fournisseurs"]]}]},{"k":"s649","code":"649","label":"Charges d'exploitation portées à l'actif (restructuration)","kind":"cost","groups":[]},{"k":"s75","code":"75","label":"Produits financiers","kind":"rev","groups":[{"label":null,"accounts":[["751000","751000","Produits des actifs circulants"],["756000","756000","Produits financiers divers"],["758200","758200","Différence sur paiements"]]}]},{"k":"s65","code":"65","label":"Charges financières","kind":"cost","groups":[{"label":null,"accounts":[["650000","650000","Intérêts sur crédit SOWECSOM"],["650010","650010","Intérêts crédit Credal"],["650015","650015","Intérêts crédit W.Alter 2025 50K"],["650020","650020","Compte 650020"],["650410","650410","Intérêts de retard sur TVA"],["650430","650430","Intérêts de retard ONSS"],["657200","657200","Frais de transac. s/ terminal de paiem."],["658100","658100","Différences de caisse"],["658200","658200","Différences sur paiements"],["659000","659000","Frais bancaires"]]}]},{"k":"s76","code":"76","label":"Produits exceptionnels","kind":"rev","groups":[{"label":null,"accounts":[["760100","760100","Régularisations et produits divers années précédentes"]]}]},{"k":"s66","code":"66","label":"Charges exceptionnelles","kind":"cost","groups":[{"label":null,"accounts":[["660100","660100","Autres charges diverses années antérieures"],["641000","641000","Moins values sur réalisation d'immobilisations corporelles"],["x263","","Autres charges exceptionnelles (non ventilées)"]]}]},{"k":"s67","code":"67","label":"Impôts","kind":"cost","groups":[{"label":null,"accounts":[["670000","670000","Impôts"],["670300","670300","Précompte Mobilier"]]}]}];

/* ---------- colonnes : 12 mois, trimestres après mars/juin/sept./déc. (facultatifs) ---------- */
export type Col = { t: 'm' | 'q'; i: number };
export const colsFor = (showQ: boolean): Col[] => {
  const c: Col[] = [];
  for (let q = 0; q < 4; q++) { for (let j = 0; j < 3; j++) c.push({ t: 'm', i: q * 3 + j }); if (showQ) c.push({ t: 'q', i: q }); }
  return c;
};

/* ---------- calcul ---------- */
export const Z12 = (): number[] => Array(12).fill(0);
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const addTo = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) a[i] += b[i] || 0; return a; };
export const leafMonths = (e?: Leaf): number[] => (!e ? Z12() : e.mode === 'annual' ? Array(12).fill((e.annual || 0) / 12) : Z12().map((_, i) => (e.months && e.months[i]) || 0));
export const accMonths = (e?: Entry): number[] => (e && e.subs && e.subs.length ? e.subs.reduce((a, s) => addTo(a, leafMonths(s)), Z12()) : leafMonths(e));
export const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
export const quarter = (m: number[], q: number) => m[q * 3] + m[q * 3 + 1] + m[q * 3 + 2];
export const colVal = (m: number[], c: Col) => (c.t === 'm' ? m[c.i] : quarter(m, c.i));

/** Formules du fichier Excel (colonnes 2026) : chaque série est un tableau de nombres (12 mois, ou 1 valeur par année). */
export function results(S: Record<string, number[]>, n: number) {
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
export const RES_AFTER: Record<string, string[]> = { nrj: ['mb'], s61: ['mbe'], s649: ['re', 'ebitda'], s65: ['rc'], s66: ['rai'], s67: ['net', 'cash'] };
export const RES_LABEL: Record<string, string> = {
  mb: 'Marge brute', mbe: "Marge brute d'exploitation", re: "Résultat d'exploitation",
  ebitda: 'EBITDA', rc: 'Résultat courant avant impôts', rai: "Résultat de l'exercice avant impôts", net: "Résultat de l'exercice (net)", cash: 'Cash flow',
};
export const RES_HINT: Record<string, string> = {
  mb: "Chiffre d'affaires (70) + autres produits (74) − approvisionnements (60) − énergie",
  mbe: "Marge brute + autres produits d'exploitation (71;74) + vinaigrerie (net) − services et biens divers (61)",
  re: "Marge brute d'exploitation − personnel externe − rémunérations (62) − amortissements (630) − réductions de valeur (631;634) − provisions (635;637) − autres charges (640) − 649",
  ebitda: "Résultat d'exploitation + amortissements (630) + réductions de valeur (631;634) + provisions (635;637)",
  rc: "Résultat d'exploitation + produits financiers (75) − charges financières (65)",
  rai: 'Résultat courant + produits exceptionnels (76) − charges exceptionnelles (66)',
  net: 'Résultat avant impôts − impôts (67)',
  cash: 'Résultat de l’exercice + amortissements (630)',
};
/** Indicateurs proposés dans l'analyse : sections du plan + résultats calculés */
export const METRICS: { id: string; label: string }[] = [
  { id: 's70', label: "Chiffre d'affaires (classe 70)" }, { id: 'mb', label: RES_LABEL.mb }, { id: 'mbe', label: RES_LABEL.mbe },
  { id: 'ebitda', label: RES_LABEL.ebitda }, { id: 're', label: RES_LABEL.re }, { id: 'net', label: RES_LABEL.net },
  { id: 's60', label: 'Approvisionnements (60)' }, { id: 's61', label: 'Services et biens divers (61)' }, { id: 's62', label: 'Rémunérations (62)' },
];

export const emptyEntry = (): Entry => ({ mode: 'annual', annual: 0, months: Z12(), subs: [] });
const leafMonthsRaw = (e: Leaf) => Z12().map((_, i) => (e.months && e.months[i]) || 0);
export const cloneEntry = (e?: Entry): Entry => {
  if (!e) return emptyEntry();
  const o: Entry = { mode: e.mode, annual: e.annual || 0, months: leafMonthsRaw(e), subs: (e.subs || []).map((s) => { const x: Sub = { id: s.id, label: s.label, mode: s.mode, annual: s.annual || 0, months: leafMonthsRaw(s) }; if (s.comment) x.comment = s.comment; return x; }) };
  if (e.comment) o.comment = e.comment;
  return o;
};
export const uid = () => Math.random().toString(36).slice(2, 9);
export const parseNum = (t: string) => { const v = parseFloat(String(t).replace(/[\s  ]/g, '').replace(',', '.')); return isFinite(v) ? v : 0; };
export const nf0 = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 });
export const fmt0 = (n: number) => (Math.abs(n) < 0.5 ? '0' : nf0.format(Math.round(n)));
export const eur0 = (n: number) => nf0.format(Math.round(n)) + ' €';
export const pctTxt = (a: number, b: number) => (Math.abs(b) < 0.5 ? '—' : (a - b >= 0 ? '+' : '−') + nf0.format(Math.abs(((a - b) / Math.abs(b)) * 100)) + ' %');

/* ---------- index des comptes ---------- */
export const secAccKeys = (s: Sec) => s.groups.flatMap((g) => g.accounts.map((a) => a[0]));
export const ACC_SEC: Record<string, Sec> = {};
export const CODE_KEY: Record<string, string> = {};
CHART.forEach((s) => s.groups.forEach((g) => g.accounts.forEach((a) => { ACC_SEC[a[0]] = s; if (a[1]) CODE_KEY[a[1]] = a[0]; })));
/** Retrouve la clé d'un compte à partir d'un code comptable (exact, sinon le plus proche par préfixe) */
export function keyForCode(code: string): string | null {
  const c = String(code || '').replace(/\D/g, '');
  if (!c) return null;
  if (CODE_KEY[c]) return CODE_KEY[c];
  const padded = c.length < 6 ? c.padEnd(6, '0') : c.slice(0, 6);
  return CODE_KEY[padded] || null;
}
/** Solde comptable (débit − crédit) -> montant du budget : produits et soldes nets = crédit − débit, charges = débit − crédit */
export const fromBalance = (key: string, balance: number) => (ACC_SEC[key] && ACC_SEC[key].kind === 'cost' ? balance : -balance);

/** Variation en % appliquée aux lignes de saisie (jamais aux sous-totaux) */
export function applyPct(plan: Plan, keys: string[], pct: number, basis: 'current' | 'hist' | 'chain', hist: Hist, refYear: number): Plan {
  const f = 1 + pct / 100;
  const rows = { ...plan.rows };
  for (const k of keys) {
    const e = cloneEntry(rows[k]);
    const hasSubs = e.subs.length > 0;
    const leaves: Leaf[] = hasSubs ? e.subs : [e];
    for (const L of leaves) {
      if (basis === 'hist' && !hasSubs) {
        const base = ((hist[k] || {})[refYear] || 0) / 12;
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
