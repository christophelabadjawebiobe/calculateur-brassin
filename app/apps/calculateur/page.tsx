'use client';
/* eslint-disable @typescript-eslint/no-explicit-any, react/no-unescaped-entities */

/**
 * Calculateur de brassin : version React / Next.js (App Router)
 * À placer dans : app/apps/calculateur/page.tsx
 *
 * - Les formules de calcul (compute, exciseAt, chFactor, promoFactor…) sont reprises à l'identique de l'ancien fichier HTML.
 * - Toute la manipulation du DOM (getElementById, innerHTML, addEventListener…) est remplacée par des hooks React.
 * - Les styles d'origine sont conservés, isolés dans la classe .cb-root pour ne pas affecter le reste de l'application.
 * - Les données restent enregistrées dans le navigateur (localStorage, clé « calculateur-brassin-v1 »).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

/* ====================================================================
   Types
   ==================================================================== */
type FmtKey = 'j33' | 'c33' | 'b75' | 'can' | 'keg';
type ExciseKey = 'b75' | 'b33n' | 'b33c' | 'keg20';
type TabId = 'params' | 'recette' | 'compare';

interface Format { key: FmtKey; label: string; long: string; size: number; unit: string; caseable: boolean }
interface Rate { id: string; name: string; rate: number }
interface Ingredient { id: string; cat: string; name: string; price: number }
interface Volume { id: string; label: string; net: number; hd: number }
interface Consumable { id: string; name: string; price: number; mode: 'piece' | 'forfait' | string }
interface Channel { id: string; name: string; base: string; pct: number }
interface EnergyHl { eau: number; elec: number; gaz: number }
interface Settings {
  vat: number;
  rates: Rate[];
  energy: EnergyHl;
  energyHl: { noHd: EnergyHl; hd: EnergyHl };
  volumes: Volume[];
  logistics: { perCase: number; perPallet: number; kegsPerPallet: number; casesPerPallet: Record<string, number> };
  ingredients: Ingredient[];
  excise: Record<ExciseKey, [number, number][]>;
  ecotax: Record<string, number>;
  perCase: Record<string, number>;
  consumables: Record<string, Consumable[]>;
  channels: Channel[];
}
interface LaborLine { profile: string; hours: number }
interface Extra { label: string; profile: string; hours: number }
interface Forfait { label: string; amount: number; disc: number }
interface Recipe {
  id: string | null; name: string; example: boolean; volumeId: string; hd: number; plato: number;
  ingredients: { ingId: string; qty: number }[];
  consOff: Record<string, boolean>;
  labor: { brew: LaborLine; bot1: LaborLine; bot2: LaborLine; keg: LaborLine };
  extras: Extra[]; forfaits: Forfait[];
  delivery: string;
  mix: Record<string, number>;
  margin: number; marginMode: string;
}
interface Promo { scheme: string; x: number; y: number; pct: number; channel: string }
interface AppState {
  v: number; settings: Settings; recipes: Recipe[]; draft: Recipe;
  selected: string | null; cmpB: string; cmpC: string; promo: Promo;
}

/* ====================================================================
   CŒUR DU CALCUL : repris à l'identique de l'ancien fichier (aucune formule modifiée)
   ==================================================================== */
const num = (v: unknown): number => { const n = parseFloat(v as string); return isFinite(n) ? n : 0; };
const FORMATS: Format[] = [
  { key: 'j33', label: '33 cl jetable', long: 'Bouteille 33 cl Long Neck (jetable)', size: 0.33, unit: 'bouteille', caseable: true },
  { key: 'c33', label: '33 cl consignée', long: 'Bouteille 33 cl APO (consignée)', size: 0.33, unit: 'bouteille', caseable: true },
  { key: 'b75', label: '75 cl', long: 'Bouteille 75 cl', size: 0.75, unit: 'bouteille', caseable: true },
  { key: 'can', label: 'Canette 33 cl', long: 'Canette 33 cl', size: 0.33, unit: 'canette', caseable: true },
  { key: 'keg', label: 'Fût 20 L', long: 'Fût 20 L', size: 20, unit: 'fût', caseable: false },
];
const TABLE_OF: Record<FmtKey, ExciseKey> = { j33: 'b33n', c33: 'b33c', b75: 'b75', can: 'b33n', keg: 'keg20' };

function exciseAt(table: [number, number][] | undefined, p: number): number {
  const t = (table || []).map((r) => [num(r[0]), num(r[1])]).sort((a, b) => a[0] - b[0]);
  if (!t.length) return 0;
  if (t.length === 1) return t[0][1];
  let i = 0;
  while (i < t.length - 2 && p > t[i + 1][0]) i++;
  const [x0, y0] = t[i], [x1, y1] = t[i + 1];
  if (x1 === x0) return y0;
  return Math.max(0, y0 + (y1 - y0) * (p - x0) / (x1 - x0));
}
function volOf(r: Recipe, s: Settings): Volume | null { return (s.volumes || []).find((v) => v.id === r.volumeId) || null; }
function netHlOf(r: Recipe, s: Settings): number { const v = volOf(r, s); return v ? num(v.net) : 0; }

interface FmtCalc {
  share: number; liters: number; units: number; ingr: number; mo: number; energy: number; consumables: number; taxes: number;
  forfait: number; deliv: number; cost: number; taxUnit: number; unitCost: number; unitHT: number; unitTTC: number;
  perCase: number; cases: number; pallets: number; caseCost: number; caseHT: number; caseTTC: number;
}
function compute(r: Recipe, s: Settings) {
  const netHl = netHlOf(r, s), netL = netHl * 100;
  const hd = num(r.hd) === 1;
  const ingr = (r.ingredients || []).map((row) => {
    const ing = s.ingredients.find((i) => i.id === row.ingId);
    const qty = num(row.qty), price = ing ? num(ing.price) : 0;
    return { ing, qty, price, cost: price * qty };
  });
  const ingrCost = ingr.reduce((a, x) => a + x.cost, 0);

  const rate = (id: string) => { const p = s.rates.find((x) => x.id === id); return p ? num(p.rate) : 0; };
  const lab = (l: LaborLine) => ({ hours: num(l.hours), rate: rate(l.profile), cost: num(l.hours) * rate(l.profile) });
  const L = { brew: lab(r.labor.brew), bot1: lab(r.labor.bot1), bot2: lab(r.labor.bot2), keg: lab(r.labor.keg) };
  const extras = (r.extras || []).map((l) => Object.assign({ label: l.label }, lab(l)));
  const extraMO = extras.reduce((a, x) => a + x.cost, 0);

  const e: Partial<EnergyHl> = (s.energyHl || ({} as Settings['energyHl']))[hd ? 'hd' : 'noHd'] || {};
  const enQ = { eau: netHl * num(e.eau), elec: netHl * num(e.elec), gaz: netHl * num(e.gaz) };
  const en = { eau: enQ.eau * num(s.energy.eau), elec: enQ.elec * num(s.energy.elec), gaz: enQ.gaz * num(s.energy.gaz) };
  const energyCost = en.eau + en.elec + en.gaz;

  const forfaits = (r.forfaits || []).map((f) => ({ label: f.label, amount: num(f.amount), disc: num(f.disc), net: num(f.amount) * (1 - num(f.disc) / 100) }));
  const forfaitTotal = forfaits.reduce((a, x) => a + x.net, 0);

  const mixRaw: Record<string, number> = {}; FORMATS.forEach((f) => { mixRaw[f.key] = Math.max(0, num(r.mix[f.key])); });
  const mixTotal = FORMATS.reduce((a, f) => a + mixRaw[f.key], 0);
  const share = (k: string) => mixTotal > 0 ? mixRaw[k] / mixTotal : 0;
  const botShare = share('j33') + share('c33') + share('b75');
  const kegShare = share('keg');
  const botMO = botShare > 0 ? L.bot1.cost + L.bot2.cost : 0;
  const kegMO = kegShare > 0 ? L.keg.cost : 0;
  const moSub1 = L.brew.cost + botMO + kegMO;
  const moCost = moSub1 + extraMO;

  const m = num(r.margin);
  const k = r.marginMode === 'margin' ? (m < 100 ? 1 / (1 - m / 100) : NaN) : 1 + m / 100;
  const vat = 1 + num(s.vat) / 100;
  const lg: Settings['logistics'] = s.logistics || { perCase: 0, perPallet: 0, kegsPerPallet: 0, casesPerPallet: {} };
  const mode = r.delivery || 'case';
  const off = r.consOff || {};
  const fm = {} as Record<FmtKey, FmtCalc>; let consTotal = 0, taxTotal = 0, delivTotal = 0, casesTotal = 0, palletsTotal = 0;

  FORMATS.forEach((f) => {
    const sh = share(f.key), liters = netL * sh, units = liters / f.size;
    const items = (s.consumables[f.key] || []).filter((i) => !off[i.id]);
    const piece = items.filter((i) => i.mode !== 'forfait').reduce((a, i) => a + num(i.price), 0);
    const forf = items.filter((i) => i.mode === 'forfait').reduce((a, i) => a + num(i.price), 0);
    const consumables = piece * units + (sh > 0 ? forf : 0);
    const taxUnit = exciseAt(s.excise[TABLE_OF[f.key]], num(r.plato)) + num((s.ecotax || {})[f.key]);
    const taxes = taxUnit * units;
    const isBot = f.key === 'j33' || f.key === 'c33' || f.key === 'b75';
    const mo = (L.brew.cost + extraMO) * sh + (isBot && botShare > 0 ? botMO * sh / botShare : 0) + (f.key === 'keg' ? kegMO : 0);
    const ingrF = ingrCost * sh, energyF = energyCost * sh, forfaitF = forfaitTotal * sh;
    const perCase = f.caseable ? (num(s.perCase[f.key]) || 24) : 0;
    const cases = (f.caseable && units > 0) ? Math.ceil(units / perCase - 1e-9) : 0;
    const pallets = units > 0 ? (f.caseable ? Math.ceil(cases / Math.max(1, num(lg.casesPerPallet[f.key])) - 1e-9)
      : Math.ceil(units / Math.max(1, num(lg.kegsPerPallet)) - 1e-9)) : 0;
    let deliv = 0;
    if (mode === 'case') deliv = f.caseable ? cases * num(lg.perCase) : pallets * num(lg.perPallet);
    else if (mode === 'pallet') deliv = pallets * num(lg.perPallet);
    const cost = ingrF + mo + energyF + consumables + taxes + forfaitF + deliv;
    const unitCost = units > 0 ? cost / units : 0;
    const unitHT = unitCost * k;
    fm[f.key] = {
      share: sh, liters, units, ingr: ingrF, mo, energy: energyF, consumables, taxes, forfait: forfaitF, deliv, cost,
      taxUnit, unitCost, unitHT, unitTTC: unitHT * vat, perCase, cases, pallets,
      caseCost: unitCost * perCase, caseHT: unitHT * perCase, caseTTC: unitHT * perCase * vat,
    };
    consTotal += consumables; taxTotal += taxes; delivTotal += deliv; casesTotal += cases; palletsTotal += pallets;
  });
  const total = ingrCost + moCost + energyCost + consTotal + taxTotal + forfaitTotal + delivTotal;
  return {
    netHl, netL, hd, ingr, ingrCost, L, extras, extraMO, moSub1, botMO, kegMO, moCost, en, enQ, energyCost,
    forfaits, forfaitTotal, consTotal, taxTotal, delivTotal, casesTotal, palletsTotal, total,
    perHl: netHl > 0 ? total / netHl : 0, k, vat, fm, mixTotal, botShare, kegShare,
    priceHT: total * k, priceTTC: total * k * vat,
    priceHlHT: netHl > 0 ? total * k / netHl : 0, priceHlTTC: netHl > 0 ? total * k * vat / netHl : 0,
  };
}
type Calc = ReturnType<typeof compute>;

function chFactor(ch: Channel | undefined, s: Settings, d?: number): number {
  d = d || 0;
  if (!ch || d > 8) return 1;
  const f = 1 - num(ch.pct) / 100;
  if (!ch.base) return f;
  return f * chFactor(s.channels.find((c) => c.id === ch.base), s, d + 1);
}
function promoFactor(p: Promo): number {
  if (p.scheme === '5+1') return 5 / 6;
  if (p.scheme === '10+1') return 10 / 11;
  if (p.scheme === 'xy') { const x = num(p.x), y = num(p.y); return x + y > 0 ? x / (x + y) : 1; }
  if (p.scheme === 'pct') return 1 - num(p.pct) / 100;
  return 1;
}

/* ====================================================================
   Utilitaires de format
   ==================================================================== */
const uid = () => Math.random().toString(36).slice(2, 9);
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const slug = (s: string) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const nfCache: Record<number, Intl.NumberFormat> = {};
const nf = (d: number) => nfCache[d] || (nfCache[d] = new Intl.NumberFormat('fr-BE', { minimumFractionDigits: d, maximumFractionDigits: d }));
const eur = (v: number | null | undefined, d = 4) => (v == null || !isFinite(v)) ? '—' : nf(d).format(v) + ' €';
const fx = new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fnum = (v: number | null | undefined, d?: number) => (v == null || !isFinite(v)) ? '—' : (d == null ? fx : nf(d)).format(v);
const pct = (v: number | null | undefined) => (v == null || !isFinite(v)) ? '' : nf(2).format(v * 100) + ' %';
const plural = (n: number, w: string) => w + (n >= 2 ? 's' : '');

const CATS = [
  { id: 'malts', label: 'Céréales & malts' },
  { id: 'houblons', label: 'Houblons & épices' },
  { id: 'divers', label: 'Levures, sucres & ingrédients divers' },
];
const BASE_RATES = ['brasseur', 'etudiant', 'coop'];
const PRESET_FORFAITS: [string, number][] = [['Création recette', 400], ['Visuel étiquette', 450], ['Frais administratifs', 100]];

/* ====================================================================
   Données par défaut
   ==================================================================== */
function defaultSettings(): Settings {
  const ing = (cat: string, name: string, price: number): Ingredient => ({ id: slug(name), cat, name, price });
  return {
    vat: 21,
    rates: [
      { id: 'brasseur', name: 'Brasseur / Ouvrier', rate: 35 },
      { id: 'etudiant', name: 'Étudiant', rate: 20 },
      { id: 'coop', name: 'Coopérateur (bénévolat)', rate: 0 },
    ],
    energy: { elec: 0.4319, gaz: 2.7505, eau: 5.5 },
    energyHl: { noHd: { eau: 6, elec: 22.44, gaz: 1.07 }, hd: { eau: 7, elec: 22.44, gaz: 1.07 } },
    volumes: [{ id: 'v10', label: '10 hl', net: 9.8, hd: 0 }, { id: 'v20', label: '20 hl standard', net: 19.6, hd: 0 }, { id: 'v20hd', label: '20 hl HD', net: 17.0, hd: 1 }],
    logistics: { perCase: 0, perPallet: 0, kegsPerPallet: 20, casesPerPallet: { j33: 60, c33: 50, b75: 50, can: 80 } },
    ingredients: [
      ing('malts', 'Pilsen', 1.22), ing('malts', 'Pale', 1.07), ing('malts', 'Biscuit', 1.23), ing('malts', 'Cara', 1.21),
      ing('malts', 'Munich', 1.08), ing('malts', 'Ruby', 1.82), ing('malts', 'MRoost', 1.31), ing('malts', 'Froment', 0.65),
      ing('malts', 'Avoine', 3.68), ing('malts', 'Seigle', 0.79), ing('malts', 'Épeautre', 1.30),
      ing('houblons', 'Centenial', 27), ing('houblons', 'Challenger', 28), ing('houblons', 'Pilgrim', 26),
      ing('houblons', 'Goldings', 28), ing('houblons', 'Cascade', 25), ing('houblons', 'Piment', 7.5), ing('houblons', 'Rhubarbe', 3),
      ing('divers', 'Levure US05', 104), ing('divers', 'Kveik', 176), ing('divers', 'Verdant', 176),
      ing('divers', 'Novalager', 210), ing('divers', 'F02', 128), ing('divers', 'Sucre inverti', 2.36), ing('divers', 'Prod. Entretien', 0.02),
    ],
    excise: {
      b75: [[6, 0.1508], [8, 0.1770], [10, 0.2047], [12, 0.2295], [14, 0.2558], [18, 0.3075]],
      b33n: [[10, 0.0894], [14, 0.1125], [18, 0.1353]],
      b33c: [[10, 0.0627], [14, 0.0860], [18, 0.1082]],
      keg20: [[6, 2.37], [8, 3.08], [10, 3.76], [12, 4.46], [14, 5.16], [18, 6.56]],
    },
    ecotax: { b75: 0.0695, j33: 0.0243, c33: 0, can: 0.0037, keg: 0 },
    perCase: { j33: 24, c33: 24, b75: 24, can: 24 },
    consumables: {
      j33: [{ id: 'j1', name: 'Bouteille', price: 0.13, mode: 'piece' }, { id: 'j2', name: 'Étiquette', price: 0.04, mode: 'piece' }, { id: 'j3', name: 'Capsule', price: 0.01, mode: 'piece' }, { id: 'j4', name: 'Carton', price: 0.02, mode: 'piece' }],
      c33: [{ id: 'c1', name: 'Bouteille', price: 0.14, mode: 'piece' }, { id: 'c2', name: 'Étiquette lavable', price: 0.09, mode: 'piece' }, { id: 'c3', name: 'Capsule', price: 0.01, mode: 'piece' }, { id: 'c4', name: 'Casier', price: 0.03, mode: 'piece' }, { id: 'c5', name: 'Frais de transport', price: 70, mode: 'forfait' }],
      b75: [{ id: 'b1', name: 'Bouteille', price: 0.33, mode: 'piece' }, { id: 'b2', name: 'Étiquette', price: 0.04, mode: 'piece' }, { id: 'b3', name: 'Capsule', price: 0.01, mode: 'piece' }, { id: 'b4', name: 'Carton', price: 0.06, mode: 'piece' }],
      can: [{ id: 'n1', name: 'Canette', price: 0.15, mode: 'piece' }, { id: 'n2', name: 'Prestation Cahute', price: 0.14, mode: 'piece' }, { id: 'n3', name: 'Étiquette', price: 0.07, mode: 'piece' }, { id: 'n4', name: 'Carton', price: 0.03, mode: 'piece' }, { id: 'n5', name: 'Forfait livraison Cahute (à renseigner)', price: 0, mode: 'forfait' }],
      keg: [{ id: 'k1', name: 'Étiquette', price: 0.01, mode: 'piece' }, { id: 'k2', name: 'Capsule', price: 0.07, mode: 'piece' }, { id: 'k3', name: 'Lavage du fût', price: 3, mode: 'piece' }, { id: 'k4', name: 'Location du fût (à renseigner)', price: 0, mode: 'piece' }, { id: 'k5', name: 'Autres coûts fûts', price: 0, mode: 'piece' }],
    },
    channels: [
      { id: 'part', name: 'Particulier', base: '', pct: 0 },
      { id: 'coop', name: 'Coopérateur', base: 'part', pct: 10 },
      { id: 'pev', name: 'Petit événement', base: 'part', pct: 15 },
      { id: 'gev', name: 'Gros événement', base: 'part', pct: 20 },
      { id: 'horeca', name: 'Horeca', base: 'part', pct: 22 },
      { id: 'pers', name: 'Personnel', base: 'horeca', pct: 18 },
      { id: 'distri', name: 'Distributeur', base: 'horeca', pct: 15 },
    ],
  };
}
function blankRecipe(o?: Partial<Recipe>): Recipe {
  return Object.assign({
    id: null, name: '', example: false, volumeId: 'v10', hd: 0, plato: 12, ingredients: [], consOff: {},
    labor: { brew: { profile: 'brasseur', hours: 8 }, bot1: { profile: 'brasseur', hours: 6 }, bot2: { profile: 'etudiant', hours: 6 }, keg: { profile: 'brasseur', hours: 2 } },
    extras: [], forfaits: [], delivery: 'case',
    mix: { j33: 100, c33: 0, b75: 0, can: 0, keg: 0 }, margin: 30, marginMode: 'markup',
  } as Recipe, o || {});
}
function seedRecipes(): Recipe[] {
  const rows = (a: [string, number][]) => a.map(([ingId, qty]) => ({ ingId, qty }));
  return [
    blankRecipe({ id: uid(), example: true, name: 'Blonde 12°P', plato: 12,
      ingredients: rows([['pilsen', 180], ['cara', 10], ['froment', 10], ['cascade', 2], ['challenger', 1.5], ['levure-us05', 0.5]]),
      mix: { j33: 40, c33: 0, b75: 30, can: 0, keg: 30 }, margin: 35,
      extras: [{ label: 'Nettoyage cuverie', profile: 'etudiant', hours: 2 }] }),
    blankRecipe({ id: uid(), example: true, name: 'Triple 16°P', plato: 16,
      ingredients: rows([['pilsen', 250], ['munich', 20], ['sucre-inverti', 25], ['pilgrim', 2], ['goldings', 2], ['f02', 0.5]]),
      mix: { j33: 30, c33: 20, b75: 50, can: 0, keg: 0 }, margin: 40,
      forfaits: [{ label: 'Création recette', amount: 400, disc: 0 }, { label: 'Visuel étiquette', amount: 450, disc: 0 }, { label: 'Frais administratifs', amount: 100, disc: 0 }] }),
    blankRecipe({ id: uid(), example: true, name: 'IPA 14°P en canettes', volumeId: 'v20', plato: 14,
      ingredients: rows([['pale', 360], ['froment', 30], ['avoine', 20], ['cascade', 8], ['centenial', 8], ['verdant', 1]]),
      mix: { j33: 0, c33: 0, b75: 0, can: 70, keg: 30 }, margin: 35 }),
  ];
}
const defaultPromo = (): Promo => ({ scheme: '5+1', x: 5, y: 1, pct: 10, channel: 'part' });
function freshState(): AppState {
  const recipes = seedRecipes();
  return { v: 2, settings: defaultSettings(), recipes, draft: clone(recipes[0]), selected: recipes[0].id, cmpB: recipes[1].id as string, cmpC: recipes[2].id as string, promo: defaultPromo() };
}

/* ====================================================================
   Stockage et migration
   ==================================================================== */
const KEY = 'calculateur-brassin-v1';

function deepMerge(a: any, b: any): any {
  const out = clone(a);
  Object.keys(b || {}).forEach((k) => {
    if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) && b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) out[k] = deepMerge(out[k], b[k]);
    else out[k] = b[k];
  });
  return out;
}
function migrateRecipe(r0: any): Recipe {
  const r = clone(r0);
  if (r.brewSize && r.volume == null) { r.volume = r.brewSize === 'h10' ? 10 : 20; r.hd = r.brewSize === 'h20hd' ? 1 : 0; }
  if (!r.volumeId && r.volume != null) { r.volumeId = num(r.volume) === 20 ? (num(r.hd) === 1 ? 'v20hd' : 'v20') : 'v10'; }
  delete r.brewSize; delete r.volume; delete r.energy; delete r.energyTouched;
  if (typeof r.hd === 'boolean') r.hd = r.hd ? 1 : 0;
  return blankRecipe(r);
}
function mergeState(p: any): AppState | null {
  if (!p || !p.settings || !Array.isArray(p.recipes)) return null;
  const d = defaultSettings(), ps = p.settings;
  const settings: any = Object.assign({}, d, ps);
  ['energyHl', 'logistics'].forEach((k) => { settings[k] = deepMerge((d as any)[k], ps[k] || {}); });
  if (!Array.isArray(ps.volumes) || !ps.volumes.length) {
    settings.volumes = clone(d.volumes);
    const nv = ps.netVolumes;
    if (nv) settings.volumes.forEach((v: Volume) => { if (isFinite(parseFloat(nv[v.id]))) v.net = parseFloat(nv[v.id]); });
  }
  delete settings.netVolumes;
  const keg: Consumable[] = settings.consumables.keg = settings.consumables.keg || [];
  keg.forEach((i) => { if (i.name === 'Nettoyage') i.name = 'Lavage du fût'; });
  if (!keg.some((i) => /location/i.test(i.name))) keg.push({ id: 'k4', name: 'Location du fût (à renseigner)', price: 0, mode: 'piece' });
  if (!keg.some((i) => /autres/i.test(i.name))) keg.push({ id: 'k5', name: 'Autres coûts fûts', price: 0, mode: 'piece' });
  settings.channels.forEach((c: Channel) => { if (c.base == null) c.base = ''; });
  const st: AppState = {
    v: 2, settings, recipes: p.recipes.map(migrateRecipe), draft: migrateRecipe(p.draft || seedRecipes()[0]),
    selected: p.selected, cmpB: p.cmpB, cmpC: p.cmpC, promo: Object.assign(defaultPromo(), p.promo || {}),
  };
  if (!st.recipes.some((r) => r.id === st.selected)) st.selected = st.recipes[0] ? st.recipes[0].id : null;
  const ids = st.recipes.map((r) => r.id);
  if (st.cmpB === undefined) st.cmpB = ids[1] || '';
  if (st.cmpC === undefined) st.cmpC = ids[2] || '';
  return st;
}
function loadState(): AppState | null {
  try { const raw = localStorage.getItem(KEY); if (raw) return mergeState(JSON.parse(raw)); } catch { /* stockage indisponible */ }
  return null;
}
const getPath = (o: unknown, p: string): any => p.split('.').reduce((acc: any, k) => acc == null ? acc : acc[k], o);
function setPath(o: unknown, p: string, v: unknown) {
  const ks = p.split('.'), last = ks.pop() as string;
  const target: any = ks.reduce((acc: any, k) => acc[k], o);
  target[last] = v;
}

/* ====================================================================
   Contexte et composants de saisie (remplacent I(), S() et syncInputs() de l'ancien code)
   ==================================================================== */
interface Ctx {
  state: AppState;
  getState: () => AppState;
  mutate: (fn: (s: AppState) => void) => void;
  setAt: (path: string, v: unknown) => void;
  toast: (m: string) => void;
  saveFile: (filename: string, text: string, bom: boolean) => void;
}
const CbCtx = createContext<Ctx>(null as unknown as Ctx);
const useCb = () => useContext(CbCtx);
const fid = (p: string) => 'f-' + p.replace(/\./g, '-');

/** Champ numérique : affiche la valeur du state, mais garde le texte tapé tant que le champ a le focus. */
function Num({ path, label, dec, min, ph }: { path: string; label: string; dec?: boolean; min?: number; ph?: string }) {
  const { state, setAt } = useCb();
  const value = getPath(state, path);
  const [text, setText] = useState<string | null>(null);
  const shown = text != null ? text : (value == null ? '' : dec ? Number(value).toFixed(4) : String(value));
  return (
    <input id={fid(path)} className="num" type="number" inputMode="decimal" step="0.0001" aria-label={label} min={min} placeholder={ph}
      value={shown}
      onFocus={() => setText(shown)}
      onBlur={() => setText(null)}
      onChange={(e) => {
        setText(e.target.value);
        let v = e.target.value === '' ? 0 : parseFloat(e.target.value); if (isNaN(v)) v = 0;
        setAt(path, v);
      }} />
  );
}
function Txt({ path, label, ph }: { path: string; label: string; ph?: string }) {
  const { state, setAt } = useCb();
  const value = getPath(state, path);
  return <input id={fid(path)} type="text" aria-label={label} placeholder={ph} value={value == null ? '' : String(value)} onChange={(e) => setAt(path, e.target.value)} />;
}
function Sel({ path, opts, label, num: isNum }: { path: string; opts: [string, string][]; label: string; num?: boolean }) {
  const { state, setAt } = useCb();
  const value = getPath(state, path);
  return (
    <select id={fid(path)} aria-label={label} value={value == null ? '' : String(value)}
      onChange={(e) => { if (isNum) { const v = parseFloat(e.target.value); setAt(path, isNaN(v) ? 0 : v); } else setAt(path, e.target.value); }}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
/** Bouton à double clic (remplace data-confirm) */
function ConfirmButton({ className, confirmText, onConfirm, children }: { className: string; confirmText: string; onConfirm: () => void; children: ReactNode }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button className={className + (armed ? ' armed' : '')} onClick={() => {
      if (!armed) { setArmed(true); clearTimeout(timer.current); timer.current = setTimeout(() => setArmed(false), 3500); return; }
      clearTimeout(timer.current); setArmed(false); onConfirm();
    }}>{armed ? confirmText : children}</button>
  );
}
const rateOpts = (s: Settings): [string, string][] => s.rates.map((r) => [r.id, r.name]);
function volOpts(s: Settings, sel: string): [string, string][] {
  const o: [string, string][] = s.volumes.map((v) => [v.id, `${v.label} · ${fnum(num(v.net))} hl nets`]);
  if (sel && !s.volumes.some((v) => v.id === sel)) o.unshift([sel, '(volume supprimé)']);
  return o;
}
const noMin: CSSProperties = { minWidth: 0 };

/* ---------- formulaires « Ajouter » ---------- */
function AddRate() {
  const { mutate, toast } = useCb();
  const [name, setName] = useState(''), [rate, setRate] = useState('');
  const add = () => {
    const n = name.trim(); if (!n) { toast('Indiquez le nom du profil'); return; }
    mutate((s) => { let id = slug(n) || uid(); if (s.settings.rates.some((r) => r.id === id)) id += '-' + uid().slice(0, 3); s.settings.rates.push({ id, name: n, rate: num(rate) }); });
    setName(''); setRate('');
  };
  return (
    <div className="addrow">
      <input type="text" placeholder="Nom du profil" aria-label="Nom du nouveau profil" value={name} onChange={(e) => setName(e.target.value)} />
      <input type="number" className="num" inputMode="decimal" step="0.0001" placeholder="€ / h" aria-label="Taux horaire du nouveau profil" value={rate} onChange={(e) => setRate(e.target.value)} />
      <button className="btn sm" onClick={add}>Ajouter un profil de personnel</button>
    </div>
  );
}
function AddVolume() {
  const { mutate, toast } = useCb();
  const [name, setName] = useState(''), [net, setNet] = useState(''), [hd, setHd] = useState('0');
  const add = () => {
    const label = name.trim(), n = num(net);
    if (!label || n <= 0) { toast('Indiquez un nom et un volume net supérieur à 0'); return; }
    mutate((s) => { let id = slug(label) || uid(); if (s.settings.volumes.some((v) => v.id === id)) id += '-' + uid().slice(0, 3); s.settings.volumes.push({ id, label, net: n, hd: num(hd) }); });
    setName(''); setNet(''); setHd('0');
  };
  return (
    <div className="addrow">
      <input type="text" placeholder="Nom du volume" aria-label="Nom du nouveau volume" value={name} onChange={(e) => setName(e.target.value)} />
      <input type="number" className="num" inputMode="decimal" step="0.0001" placeholder="hl nets" aria-label="Volume net en hl" value={net} onChange={(e) => setNet(e.target.value)} />
      <select aria-label="Type du volume" value={hd} onChange={(e) => setHd(e.target.value)}><option value="0">Non-HD</option><option value="1">HD</option></select>
      <button className="btn sm" onClick={add}>Ajouter un volume net</button>
    </div>
  );
}
function AddBaseIng({ cat }: { cat: string }) {
  const { mutate, toast } = useCb();
  const [name, setName] = useState(''), [price, setPrice] = useState('');
  const add = () => {
    const n = name.trim(); if (!n) { toast('Indiquez le nom de l\'ingrédient'); return; }
    mutate((s) => { let id = slug(n) || uid(); if (s.settings.ingredients.some((i) => i.id === id)) id += '-' + uid().slice(0, 3); s.settings.ingredients.push({ id, cat, name: n, price: num(price) }); });
    setName(''); setPrice('');
  };
  return (
    <div className="addrow">
      <input type="text" placeholder="Nouvel ingrédient" aria-label="Nom du nouvel ingrédient" value={name} onChange={(e) => setName(e.target.value)} />
      <input type="number" className="num" inputMode="decimal" step="0.0001" placeholder="€ / kg" aria-label="Prix au kg" value={price} onChange={(e) => setPrice(e.target.value)} />
      <button className="btn sm" onClick={add}>Ajouter</button>
    </div>
  );
}
function AddExcise({ k }: { k: ExciseKey }) {
  const { mutate, toast } = useCb();
  const [p, setP] = useState(''), [v, setV] = useState('');
  const add = () => {
    if (p === '' || v === '') { toast('Renseignez le °P et le montant'); return; }
    mutate((s) => { const t = s.settings.excise[k]; t.push([num(p), num(v)]); t.sort((x, y) => x[0] - y[0]); });
    setP(''); setV('');
  };
  return (
    <div className="addrow">
      <input type="number" className="num" inputMode="decimal" step="0.0001" placeholder="°P" aria-label="Degré Plato du palier" value={p} onChange={(e) => setP(e.target.value)} />
      <input type="number" className="num" inputMode="decimal" step="0.0001" placeholder="€" aria-label="Accises du palier" value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn sm" onClick={add}>Ajouter un palier</button>
    </div>
  );
}
function AddCons({ f }: { f: FmtKey }) {
  const { mutate, toast } = useCb();
  const [name, setName] = useState(''), [price, setPrice] = useState(''), [mode, setMode] = useState('piece');
  const add = () => {
    const n = name.trim(); if (!n) { toast('Indiquez le nom du consommable'); return; }
    mutate((s) => { s.settings.consumables[f].push({ id: uid(), name: n, price: num(price), mode }); });
    setName(''); setPrice(''); setMode('piece');
  };
  return (
    <div className="addrow">
      <input type="text" placeholder="Consommable sur mesure" aria-label="Nom du consommable" value={name} onChange={(e) => setName(e.target.value)} />
      <input type="number" className="num" inputMode="decimal" step="0.0001" placeholder="€" aria-label="Prix du consommable" value={price} onChange={(e) => setPrice(e.target.value)} />
      <select aria-label="Mode de facturation" value={mode} onChange={(e) => setMode(e.target.value)}><option value="piece">€ / pièce</option><option value="forfait">Forfait brassin</option></select>
      <button className="btn sm" onClick={add}>Ajouter</button>
    </div>
  );
}
function AddChan({ channels }: { channels: Channel[] }) {
  const { mutate, toast } = useCb();
  const [name, setName] = useState(''), [pctV, setPctV] = useState(''), [base, setBase] = useState('part');
  const add = () => {
    const n = name.trim(); if (!n) { toast('Indiquez le nom du canal'); return; }
    mutate((s) => { s.settings.channels.push({ id: uid(), name: n, base, pct: num(pctV) }); });
    setName(''); setPctV(''); setBase('part');
  };
  const opts: [string, string][] = [['', 'Prix calculé (sans base)'], ...channels.map((c): [string, string] => [c.id, 'Remise sur ' + c.name])];
  return (
    <div className="addrow">
      <input type="text" placeholder="Nom du canal" aria-label="Nom du nouveau canal" value={name} onChange={(e) => setName(e.target.value)} />
      <input type="number" className="num" inputMode="decimal" step="0.0001" placeholder="Remise %" aria-label="Remise du nouveau canal" value={pctV} onChange={(e) => setPctV(e.target.value)} />
      <select aria-label="Base de la remise" value={base} onChange={(e) => setBase(e.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <button className="btn sm" onClick={add}>Ajouter un canal</button>
    </div>
  );
}

/* ====================================================================
   ONGLET 1 : Paramètres
   ==================================================================== */
function SettingsTab() {
  const { state, getState, mutate, toast } = useCb();
  const s = state.settings;

  const exTables: { k: ExciseKey; t: string; sub?: string; eco: [string, string, string][] }[] = [
    { k: 'b75', t: 'Bouteilles 75 cl', eco: [['b75', 'Écotaxe Fost Plus', '€ / bouteille']] },
    { k: 'b33n', t: 'Bouteilles 33 cl non consignées', sub: 'Ces accises servent aussi aux canettes 33 cl.', eco: [['j33', 'Écotaxe One way (bouteille jetable)', '€ / bouteille'], ['can', 'Écotaxe Can (canette)', '€ / canette']] },
    { k: 'b33c', t: 'Bouteilles 33 cl consignées', sub: 'Pas d\'écotaxe pour la bouteille consignée.', eco: [] },
    { k: 'keg20', t: 'Fûts 20 L', sub: 'Accises par fût, selon le degré Plato.', eco: [] },
  ];
  const baseOpts = (selfId: string): [string, string][] => [['', 'Prix calculé (sans base)'], ...s.channels.filter((c) => c.id !== selfId).map((c): [string, string] => [c.id, 'Remise sur ' + c.name])];

  return (
    <>
      <div className="sec-title"><h2>Personnel, énergie et volumes</h2><p>Tout est modifiable ; les calculs suivent aussitôt.</p></div>
      <div className="grid">
        <div className="card"><h3>Profils de personnel</h3>
          <div className="rows">
            {s.rates.map((r, i) => (
              <div className="row r-rate" key={r.id}>
                <Txt path={`settings.rates.${i}.name`} label="Profil" />
                <div className="with-unit"><Num path={`settings.rates.${i}.rate`} label={'Taux horaire ' + r.name} dec /><span>€ / h</span></div>
                {BASE_RATES.includes(r.id) ? <span></span> : <button className="icon-btn" aria-label={'Supprimer ' + r.name} title="Supprimer" onClick={() => mutate((st) => { st.settings.rates.splice(i, 1); })}>×</button>}
              </div>
            ))}
          </div>
          <AddRate />
        </div>

        <div className="card"><h3>Tarifs énergie</h3>
          <div className="rows">
            {([['eau', 'Eau', '€ / m³'], ['gaz', 'Gaz', '€ / m³'], ['elec', 'Électricité', '€ / kWh']] as const).map(([k, l, u]) => (
              <div className="row r-energy" key={k}><span className="lbl">{l}</span><div className="with-unit"><Num path={`settings.energy.${k}`} label={'Prix ' + l} dec /><span>{u}</span></div></div>
            ))}
          </div>
          <h3 style={{ marginTop: 14 }}>Consommation par HL produit</h3>
          <div className="rows">
            <div className="row r-hd head"><span></span><span className="lbl-s" style={{ textAlign: 'right' }}>Non-HD</span><span className="lbl-s" style={{ textAlign: 'right' }}>HD</span></div>
            {([['eau', 'Eau (m³)'], ['elec', 'Électricité (kWh)'], ['gaz', 'Gaz (m³)']] as const).map(([k, l]) => (
              <div className="row r-hd" key={k}><span className="lbl">{l}</span><Num path={`settings.energyHl.noHd.${k}`} label={l + ' non-HD'} /><Num path={`settings.energyHl.hd.${k}`} label={l + ' HD'} /></div>
            ))}
          </div>
          <p className="note">Coût d'énergie d'un brassin = HL nets × consommation par HL × prix unitaires. La recette choisit la colonne HD ou non-HD.</p>
        </div>

        <div className="card"><h3>Volumes nets des brassins</h3>
          <div className="rows">
            {s.volumes.map((v, i) => (
              <div className="row r-vol" key={v.id}>
                <span className="n"><Txt path={`settings.volumes.${i}.label`} label="Nom du volume" /></span>
                <span className="p with-unit"><Num path={`settings.volumes.${i}.net`} label={'Volume net de ' + v.label} /><span style={noMin}>hl</span></span>
                <span className="h"><Sel path={`settings.volumes.${i}.hd`} opts={[['0', 'Non-HD'], ['1', 'HD']]} label={'Type du volume ' + v.label} num /></span>
                <button className="icon-btn d" aria-label={'Supprimer ' + v.label} title="Supprimer" onClick={() => {
                  if (getState().settings.volumes.length <= 1) { toast('Gardez au moins un volume net'); return; }
                  mutate((st) => { st.settings.volumes.splice(i, 1); });
                }}>×</button>
              </div>
            ))}
          </div>
          <AddVolume />
          <p className="note">La recette choisit un volume dans cette liste. Un volume HD active la formule d'énergie HD.</p>
          <div className="rows" style={{ marginTop: 10 }}>
            <div className="row r-energy"><span className="lbl">TVA sur les ventes</span><div className="with-unit"><Num path="settings.vat" label="TVA" /><span>%</span></div></div>
          </div>
        </div>
      </div>

      <div className="sec-title"><h2>Logistique, colisage et livraison</h2><p>Le calcul de livraison suit le nombre de caisses et de palettes générées</p></div>
      <div className="grid">
        <div className="card"><h3>Tarifs de livraison</h3>
          <div className="rows">
            <div className="row r-energy"><span className="lbl">Prix par caisse</span><div className="with-unit"><Num path="settings.logistics.perCase" label="Prix de livraison par caisse" dec /><span>€ / caisse</span></div></div>
            <div className="row r-energy"><span className="lbl">Prix par palette</span><div className="with-unit"><Num path="settings.logistics.perPallet" label="Prix de livraison par palette" dec /><span>€ / palette</span></div></div>
          </div>
          <p className="note">Montants à renseigner : ils sont à 0 € tant que vous ne les saisissez pas.</p>
        </div>
        <div className="card"><h3>Colisage par palette</h3>
          <div className="rows">
            <div className="row r-colis head"><span className="lbl-s">Format</span><span className="lbl-s" style={{ textAlign: 'right' }}>Pièces / caisse</span><span className="lbl-s" style={{ textAlign: 'right' }}>Caisses / palette</span></div>
            {FORMATS.filter((f) => f.caseable).map((f) => (
              <div className="row r-colis" key={f.key}><span className="lbl">{f.long}</span><Num path={`settings.perCase.${f.key}`} label={'Pièces par caisse ' + f.label} /><Num path={`settings.logistics.casesPerPallet.${f.key}`} label={'Caisses par palette ' + f.label} /></div>
            ))}
            <div className="row r-energy"><span className="lbl">1 palette de fûts</span><div className="with-unit"><Num path="settings.logistics.kegsPerPallet" label="Fûts par palette" /><span>fûts</span></div></div>
          </div>
          <p className="note">Les caisses par palette sont des valeurs de départ à vérifier avec votre transporteur.</p>
        </div>
      </div>

      <div className="sec-title"><h2>Matières premières</h2><p>Prix au kilo</p></div>
      <div className="grid">
        {CATS.map((cat) => (
          <div className="card" key={cat.id}><h3>{cat.label} <span className="hint">· € / kg</span></h3>
            <div className="rows">
              {s.ingredients.map((ing, i) => ({ ing, i })).filter((o) => o.ing.cat === cat.id).map(({ ing, i }) => (
                <div className="row r-base" key={ing.id}>
                  <Txt path={`settings.ingredients.${i}.name`} label="Ingrédient" />
                  <div className="with-unit"><Num path={`settings.ingredients.${i}.price`} label={'Prix au kg ' + ing.name} dec /><span style={noMin}></span></div>
                  <button className="icon-btn" aria-label={'Supprimer ' + ing.name} title="Supprimer" onClick={() => mutate((st) => { st.settings.ingredients.splice(i, 1); })}>×</button>
                </div>
              ))}
            </div>
            <AddBaseIng cat={cat.id} />
          </div>
        ))}
      </div>

      <div className="sec-title"><h2>Taxes et accises</h2><p>Selon le degré Plato. Entre deux paliers, la valeur est interpolée.</p></div>
      <div className="grid">
        {exTables.map((tb) => (
          <div className="card" key={tb.k}><h3>{tb.t}</h3>
            {tb.sub && <p className="hint" style={{ margin: '-4px 0 8px' }}>{tb.sub}</p>}
            <div className="rows">
              {s.excise[tb.k].map((r, i) => (
                <div className="row r-excise" key={i}>
                  <div className="with-unit"><Num path={`settings.excise.${tb.k}.${i}.0`} label="Degré Plato" /><span style={noMin}>°P</span></div>
                  <div className="with-unit"><Num path={`settings.excise.${tb.k}.${i}.1`} label={'Accises à ' + r[0] + ' °P'} dec /><span>€</span></div>
                  <button className="icon-btn" aria-label={`Supprimer le palier ${r[0]} °P`} title="Supprimer" onClick={() => {
                    if (getState().settings.excise[tb.k].length <= 2) { toast('Gardez au moins deux paliers pour l\'interpolation'); return; }
                    mutate((st) => { st.settings.excise[tb.k].splice(i, 1); });
                  }}>×</button>
                </div>
              ))}
            </div>
            <AddExcise k={tb.k} />
            {tb.eco.length > 0 && (
              <div className="rows" style={{ marginTop: 10 }}>
                {tb.eco.map(([k, l, u]) => (
                  <div className="row r-energy" key={k}><span className="lbl">{l}</span><div className="with-unit"><Num path={`settings.ecotax.${k}`} label={l} dec /><span>{u}</span></div></div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="sec-title"><h2>Consommables et spécificités des fûts</h2><p>À la pièce, ou en forfait par brassin (appliqué si le format est utilisé)</p></div>
      <div className="grid">
        {FORMATS.map((f) => (
          <div className="card" key={f.key}><h3>{f.key === 'keg' ? 'Fûts 20 L · étiquette, capsule, lavage, location, autres coûts' : f.long}</h3>
            <div className="rows">
              {s.consumables[f.key].map((c, i) => (
                <div className="row r-cons" key={c.id}>
                  <span className="n"><Txt path={`settings.consumables.${f.key}.${i}.name`} label="Consommable" /></span>
                  <span className="p"><Num path={`settings.consumables.${f.key}.${i}.price`} label={'Prix ' + c.name} dec /></span>
                  <span className="m"><Sel path={`settings.consumables.${f.key}.${i}.mode`} opts={[['piece', '€ / pièce'], ['forfait', 'Forfait brassin']]} label="Mode de facturation" /></span>
                  <button className="icon-btn d" aria-label={'Supprimer ' + c.name} title="Supprimer" onClick={() => mutate((st) => { st.settings.consumables[f.key].splice(i, 1); })}>×</button>
                </div>
              ))}
            </div>
            <AddCons f={f.key} />
          </div>
        ))}
      </div>

      <div className="sec-title"><h2>Canaux de vente</h2><p>Chaque remise s'applique sur le canal de base choisi</p></div>
      <div className="card">
        <div className="rows">
          {s.channels.map((c, i) => (
            <div className="row r-chan" key={c.id}>
              <span className="n"><Txt path={`settings.channels.${i}.name`} label="Nom du canal" /></span>
              <span className="b"><Sel path={`settings.channels.${i}.base`} opts={baseOpts(c.id)} label={'Base de la remise pour ' + c.name} /></span>
              <span className="p with-unit"><Num path={`settings.channels.${i}.pct`} label={'Remise ' + c.name} /><span style={noMin}>%</span></span>
              {c.id === 'part' ? <span className="d"></span> : (
                <button className="icon-btn d" aria-label={'Supprimer ' + c.name} title="Supprimer" onClick={() => mutate((st) => {
                  const ch = st.settings.channels[i]; if (!ch) return;
                  st.settings.channels.splice(i, 1); st.settings.channels.forEach((cc) => { if (cc.base === ch.id) cc.base = ch.base || ''; });
                })}>×</button>
              )}
            </div>
          ))}
        </div>
        <AddChan channels={s.channels} />
      </div>

      <div className="sec-title"><h2>Réinitialisation</h2><p>La sauvegarde et la restauration de toute la base se trouvent dans l'onglet Recette.</p></div>
      <div className="card">
        <div className="btn-row">
          <ConfirmButton className="btn danger" confirmText="Confirmer : tout remettre aux valeurs d'origine" onConfirm={() => {
            mutate((st) => { Object.assign(st, freshState()); });
            toast('Paramètres remis aux valeurs d\'origine');
          }}>Réinitialiser tous les paramètres</ConfirmButton>
        </div>
        <p className="note">La réinitialisation remet aussi les trois recettes d'exemple ; vos recettes enregistrées sont remplacées.</p>
      </div>
    </>
  );
}

/* ====================================================================
   ONGLET 2 : Recette et simulateur
   ==================================================================== */
function LabRow({ k, label, c }: { k: 'brew' | 'bot1' | 'bot2' | 'keg'; label: string; c: Calc }) {
  const { state } = useCb();
  const applied = k === 'brew' ? true : k === 'keg' ? c.kegShare > 0 : c.botShare > 0;
  return (
    <div className="row r-lab">
      <span className="lbl">{label}</span>
      <Sel path={`draft.labor.${k}.profile`} opts={rateOpts(state.settings)} label={'Profil ' + label} />
      <div className="with-unit"><Num path={`draft.labor.${k}.hours`} label={'Heures ' + label} /><span style={noMin}>h</span></div>
      <span className="out">{applied ? eur(c.L[k].cost) : 'non utilisé'}</span>
    </div>
  );
}

function ResultsCard({ c }: { c: Calc }) {
  const { state } = useCb();
  const d = state.draft, s = state.settings;
  const parts: [string, number, string][] = [['Ingrédients', c.ingrCost, '--c1'], ['Main-d\'œuvre', c.moCost, '--c2'], ['Énergie et eau', c.energyCost, '--c3'], ['Consommables', c.consTotal, '--c4'], ['Taxes et accises', c.taxTotal, '--c5'], ['Forfaits et prestations', c.forfaitTotal, '--c6'], ['Livraison', c.delivTotal, '--c7']];
  const used = FORMATS.filter((f) => c.fm[f.key].share > 0);
  const missing = c.ingr.filter((x) => !x.ing).length;
  const warns: string[] = [];
  if (!volOf(d, s)) warns.push('Le volume net de cette recette n\'existe plus dans la base : choisissez-en un autre.');
  if (!c.ingr.length) warns.push('Ajoutez au moins un ingrédient pour obtenir un coût réaliste.');
  if (missing) warns.push(`${missing} ingrédient${missing > 1 ? 's' : ''} supprimé${missing > 1 ? 's' : ''} de la base : compté${missing > 1 ? 's' : ''} à 0 €.`);
  if (!isFinite(c.k)) warns.push('Une marge de 100 % sur le prix de vente est impossible.');
  return (
    <>
      <h2>{d.name || 'Recette sans nom'}{d.example && <span className="badge">Exemple</span>}</h2>
      <p className="hint" style={{ margin: '2px 0 0' }}>{(volOf(d, s) || { label: '' }).label || 'Volume ?'}{c.hd ? ' · HD' : ''} · {fnum(c.netHl)} hl nets · {fnum(num(d.plato))} °P · marge {fnum(num(d.margin))} % {d.marginMode === 'margin' ? 'sur prix' : 'sur coût'}</p>
      <div className="kpis">
        <div className="kpi"><div className="v">{eur(c.perHl)}</div><div className="l">Coût de revient par HL</div></div>
        <div className="kpi"><div className="v">{eur(c.priceHlHT)}</div><div className="l">Prix de vente par HL, HTVA</div></div>
        <div className="kpi"><div className="v">{eur(c.total)}</div><div className="l">Coût du brassin</div></div>
        <div className="kpi"><div className="v">{eur(c.priceHT)}</div><div className="l">Prix du brassin, HTVA</div></div>
      </div>
      {c.total > 0 && (
        <div className="bar" aria-hidden="true">
          {parts.map((p) => <i key={p[0]} title={p[0]} style={{ flex: `${Math.max(p[1], 0)} 1 0`, background: `var(${p[2]})` }} />)}
        </div>
      )}
      <div className="legend">
        {parts.map((p) => (
          <div key={p[0]}><b style={{ background: `var(${p[2]})` }}></b><span>{p[0]}</span><span className="mono">{eur(p[1])}</span><em>{c.total > 0 ? pct(p[1] / c.total) : ''}</em></div>
        ))}
      </div>
      {used.length > 0 && (
        <div className="scroll" style={{ marginTop: 14 }}>
          <table className="fmt-tbl">
            <thead><tr><th>Format</th><th>Coût / pièce</th><th>HTVA</th><th>TVAC</th></tr></thead>
            <tbody>
              {used.map((f) => {
                const x = c.fm[f.key];
                return <tr key={f.key}><td>{f.label}<br /><span className="hint">{fnum(x.units, 0)} {plural(x.units, f.unit)}</span></td><td className="n">{eur(x.unitCost)}</td><td className="n">{eur(x.unitHT)}</td><td className="n">{eur(x.unitTTC)}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
      {warns.map((w) => <div className="alert" key={w}>{w}</div>)}
    </>
  );
}

function RecipeTab() {
  const { state, getState, mutate, setAt, toast, saveFile } = useCb();
  const d = state.draft, s = state.settings;
  const c = useMemo(() => compute(state.draft, state.settings), [state.draft, state.settings]);
  const importRecipeRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const top = () => window.scrollTo(0, 0);

  const mixTot = FORMATS.reduce((a, f) => a + Math.max(0, num(d.mix[f.key])), 0);
  const e = s.energyHl[c.hd ? 'hd' : 'noHd'];

  /* ---- actions ---- */
  const saveRecipe = () => {
    mutate((st) => {
      const r = clone(st.draft); r.name = (r.name || '').trim() || 'Recette sans nom'; r.example = false;
      const i = r.id ? st.recipes.findIndex((x) => x.id === r.id) : -1;
      if (i >= 0) st.recipes[i] = r; else { r.id = uid(); st.recipes.push(r); }
      st.draft.id = r.id; st.draft.name = r.name; st.draft.example = false;
      if (!st.selected) st.selected = r.id;
    });
    toast('Recette enregistrée');
  };
  const exportRecipeJson = () => {
    const st = getState(), sg = st.settings;
    const dd = clone(st.draft); dd.name = (dd.name || '').trim() || 'Recette sans nom'; dd.id = null; dd.example = false;
    const usedProfiles = new Set([dd.labor.brew, dd.labor.bot1, dd.labor.bot2, dd.labor.keg, ...dd.extras].map((l) => l.profile));
    const refs = {
      ingredients: dd.ingredients.map((x) => sg.ingredients.find((i) => i.id === x.ingId)).filter(Boolean),
      volumes: [volOf(dd, sg)].filter(Boolean),
      rates: sg.rates.filter((r) => usedProfiles.has(r.id)),
    };
    const { id: _omit, ...recipe } = dd; void _omit;
    saveFile(`${slug(dd.name) || 'recette'}.json`, JSON.stringify({ kind: 'recette-brasserie', version: 1, recipe, refs }, null, 1), false);
  };
  const onImportBackup = (file: File) => {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = JSON.parse(String(fr.result));
        if (data && data.kind === 'recette-brasserie') { toast('Ce fichier est une seule recette : utilisez « Importer une recette »'); return; }
        const st = mergeState(data);
        if (!st) throw new Error('format');
        mutate((cur) => { Object.assign(cur, st); });
        toast('Sauvegarde restaurée');
      } catch { toast('Fichier de sauvegarde non reconnu'); }
    };
    fr.readAsText(file);
  };
  const onImportRecipe = (file: File) => {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = JSON.parse(String(fr.result));
        if (data && data.settings && Array.isArray(data.recipes)) { toast('Ce fichier est une sauvegarde complète : utilisez « Restaurer une sauvegarde »'); return; }
        const rec = data && data.kind === 'recette-brasserie' ? data.recipe : data;
        if (!rec || typeof rec !== 'object' || !Array.isArray(rec.ingredients)) throw new Error('format');
        const refs = (data && data.refs) || {}; let added = 0;
        mutate((st) => {
          const sg = st.settings;
          (refs.ingredients || []).forEach((i: any) => { if (i && i.id && !sg.ingredients.some((x) => x.id === i.id)) { sg.ingredients.push({ id: i.id, cat: i.cat || 'divers', name: i.name || i.id, price: num(i.price) }); added++; } });
          (refs.volumes || []).forEach((v: any) => { if (v && v.id && !sg.volumes.some((x) => x.id === v.id)) { sg.volumes.push({ id: v.id, label: v.label || v.id, net: num(v.net), hd: num(v.hd) }); added++; } });
          (refs.rates || []).forEach((r: any) => { if (r && r.id && !sg.rates.some((x) => x.id === r.id)) { sg.rates.push({ id: r.id, name: r.name || r.id, rate: num(r.rate) }); added++; } });
          st.draft = migrateRecipe(rec); st.draft.id = null; st.draft.example = false;
        });
        top();
        toast(added ? `Recette importée, ${added} élément${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''} à la base` : 'Recette importée : vérifiez puis enregistrez');
      } catch { toast('Fichier de recette non reconnu'); }
    };
    fr.readAsText(file);
  };

  const presets = PRESET_FORFAITS.map(([n, a]) => (
    <button key={n} className="btn sm" onClick={() => mutate((st) => { st.draft.forfaits.push({ label: n, amount: a, disc: 0 }); })}>+ {n} ({eur(a, 0)})</button>
  ));

  return (
    <div className="split">
      <div className="stack">
        <div className="card"><h2>Recette</h2>
          <div className="fields" style={{ marginTop: 12 }}>
            <div className="field" style={{ gridColumn: '1/-1' }}>
              <label className="lbl-s" htmlFor="f-draft-name">Nom de la recette / client{d.example && <span className="badge">Exemple</span>}</label>
              <Txt path="draft.name" label="Nom de la recette" ph="ex. Tchantchès Grand Cru, Univers'ale…" />
            </div>
            <div className="field"><label className="lbl-s" htmlFor="f-draft-volumeId">Volume net du brassin</label><Sel path="draft.volumeId" opts={volOpts(s, d.volumeId)} label="Volume net du brassin" /></div>
            <div className="field"><label className="lbl-s" htmlFor="f-draft-hd">Haute densité (HD)</label><Sel path="draft.hd" opts={[['0', 'Non'], ['1', 'Oui']]} label="Option haute densité" num /></div>
            <div className="field"><label className="lbl-s" htmlFor="f-draft-plato">Degré Plato (accises)</label><div className="with-unit"><Num path="draft.plato" label="Degré Plato" /><span style={noMin}>°P</span></div></div>
          </div>
          <p className="note">{volOf(d, s) ? `${fnum(c.netHl)} hl nets${c.hd ? ', formule d\'énergie haute densité' : ''}.` : 'Volume supprimé de la base : choisissez un volume net.'}</p>
        </div>

        <div className="card"><h2>Ingrédients</h2>
          <div className="rows" style={{ marginTop: 8 }}>
            <div className="row head r-ing"><span className="lbl-s">Ingrédient</span><span className="lbl-s" style={{ textAlign: 'right' }}>Quantité (kg)</span><span className="lbl-s" style={{ textAlign: 'right' }}>Coût</span><span></span></div>
            {d.ingredients.map((row, i) => {
              const x = c.ingr[i];
              return (
                <div className="row r-ing" key={i}>
                  <select id={`f-draft-ingredients-${i}-ingId`} aria-label={`Ingrédient ${i + 1}`} value={row.ingId}
                    title={x && x.ing ? `${eur(x.price)} / kg` : 'Ingrédient supprimé de la base'}
                    onChange={(ev) => setAt(`draft.ingredients.${i}.ingId`, ev.target.value)}>
                    {row.ingId && !s.ingredients.some((g) => g.id === row.ingId) && <option value={row.ingId}>(ingrédient supprimé)</option>}
                    {CATS.map((cat) => {
                      const items = s.ingredients.filter((g) => g.cat === cat.id);
                      return items.length ? <optgroup key={cat.id} label={cat.label}>{items.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</optgroup> : null;
                    })}
                  </select>
                  <div className="with-unit"><Num path={`draft.ingredients.${i}.qty`} label="Quantité en kg" /></div>
                  <span className="out">{x && x.ing ? eur(x.cost) : '—'}</span>
                  <button className="icon-btn" aria-label="Retirer la ligne" title="Retirer" onClick={() => mutate((st) => { st.draft.ingredients.splice(i, 1); })}>×</button>
                </div>
              );
            })}
          </div>
          {!d.ingredients.length && <p className="empty">Aucun ingrédient pour l'instant.</p>}
          <div className="addrow"><button className="btn sm" onClick={() => mutate((st) => { st.draft.ingredients.push({ ingId: (st.settings.ingredients[0] || { id: '' }).id || '', qty: 0 }); })}>Ajouter un ingrédient</button></div>
          <div className="total-line"><span>Total ingrédients</span><span className="mono">{eur(c.ingrCost)}</span></div>
        </div>

        <div className="card"><h2>Énergie et eau</h2>
          <p className="hint" style={{ margin: '2px 0 8px' }}>Formule {c.hd ? 'HD' : 'non-HD'} par HL : {fnum(num(e.eau), 2)} m³ d'eau + {fnum(num(e.elec), 2)} kWh + {fnum(num(e.gaz), 2)} m³ de gaz, pour {fnum(c.netHl)} hl nets.</p>
          <div className="rows">
            <div className="row r-en"><span className="lbl">Eau</span><span className="out">{fnum(c.enQ.eau, 4)} m³</span><span className="out">{eur(c.en.eau)}</span></div>
            <div className="row r-en"><span className="lbl">Gaz</span><span className="out">{fnum(c.enQ.gaz, 4)} m³</span><span className="out">{eur(c.en.gaz)}</span></div>
            <div className="row r-en"><span className="lbl">Électricité</span><span className="out">{fnum(c.enQ.elec, 4)} kWh</span><span className="out">{eur(c.en.elec)}</span></div>
          </div>
          <div className="total-line"><span>Total énergie et eau</span><span className="mono">{eur(c.energyCost)}</span></div>
        </div>

        <div className="card"><h2>Ventilation du conditionnement</h2>
          <p className="hint" style={{ margin: '2px 0 8px' }}>Part du volume net remplie dans chaque format.</p>
          <div className="rows">
            {FORMATS.map((f) => {
              const x = c.fm[f.key];
              return (
                <div className="row r-mix" key={f.key}>
                  <span className="lbl">{f.label}</span>
                  <div className="with-unit"><Num path={`draft.mix.${f.key}`} label={'Part ' + f.label} min={0} /><span style={noMin}>%</span></div>
                  <span className="out hint">{x.share > 0 ? `${fnum(x.liters, 2)} L · ${fnum(x.units, 0)} ${plural(x.units, f.unit)}` : '—'}</span>
                </div>
              );
            })}
          </div>
          <div className="total-line"><span>Total</span><span className="mono">{fnum(mixTot, 2)} %</span></div>
          <div>
            {mixTot === 0 ? <div className="alert bad">Aucun format sélectionné : conditionnement, taxes et livraison ne sont pas calculés.</div>
              : (Math.abs(mixTot - 100) > 0.001 ? <div className="alert">Le total fait {fnum(mixTot, 2)} %. Les parts sont ramenées à 100 % au prorata.</div> : null)}
          </div>
        </div>

        <div className="card"><h2>Consommables</h2>
          <p className="hint" style={{ margin: '2px 0 4px' }}>Cochez les consommables utilisés. Seuls les formats de la ventilation apparaissent.</p>
          {FORMATS.filter((f) => c.fm[f.key].share > 0).map((f) => (
            <div className="cgrp" key={f.key}><h3>{f.long}</h3>
              <div className="rows">
                {s.consumables[f.key].map((cc) => (
                  <div className="row r-csel" key={cc.id}>
                    <input type="checkbox" id={`f-cons-${cc.id}`} aria-label={'Inclure ' + cc.name} checked={!d.consOff[cc.id]} onChange={(ev) => setAt(`draft.consOff.${cc.id}`, !ev.target.checked)} />
                    <label htmlFor={`f-cons-${cc.id}`}>{cc.name}</label>
                    <span className="pr">{eur(num(cc.price))}{cc.mode === 'forfait' ? ' · forfait' : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!(c.mixTotal > 0) && <p className="empty">Aucun format sélectionné dans la ventilation.</p>}
        </div>

        <div className="card"><h2>Main-d'œuvre</h2>
          <div className="rows" style={{ marginTop: 8 }}>
            <LabRow k="brew" label="Brassage" c={c} />
            <div className="row plain"><span className="lbl-s">Soutirage bouteilles</span></div>
            <LabRow k="bot1" label="Aidant 1" c={c} /><LabRow k="bot2" label="Aidant 2" c={c} />
            <div className="row plain"><span className="lbl-s">Soutirage fûts</span></div>
            <LabRow k="keg" label="Profil unique" c={c} />
          </div>
          <div className="sub-line"><span>Sous-total brassage et soutirage</span><span className="mono">{eur(c.moSub1)}</span></div>
          <p className="note">Le soutirage est compté seulement si le format correspondant est utilisé. Les canettes passent par la prestation Cahute.</p>
          <h3 style={{ marginTop: 16 }}>Heures supplémentaires et tâches complémentaires</h3>
          <div className="rows">
            {d.extras.map((x, i) => (
              <div className="row r-extra" key={i}>
                <span className="lbl"><Txt path={`draft.extras.${i}.label`} label="Tâche complémentaire" ph="Tâche annexe" /></span>
                <Sel path={`draft.extras.${i}.profile`} opts={rateOpts(s)} label={`Profil de la tâche ${i + 1}`} />
                <div className="with-unit"><Num path={`draft.extras.${i}.hours`} label={`Heures de la tâche ${i + 1}`} /><span style={noMin}>h</span></div>
                <span className="out">{eur(c.extras[i] ? c.extras[i].cost : 0)}</span>
                <button className="icon-btn" aria-label="Retirer la tâche" title="Retirer" onClick={() => mutate((st) => { st.draft.extras.splice(i, 1); })}>×</button>
              </div>
            ))}
          </div>
          {!d.extras.length && <p className="empty" style={{ padding: '6px 0' }}>Aucune heure annexe.</p>}
          <div className="addrow"><button className="btn sm" onClick={() => mutate((st) => { st.draft.extras.push({ label: '', profile: (st.settings.rates[0] || { id: '' }).id || '', hours: 1 }); })}>Ajouter une ligne d'heures</button></div>
          <div className="sub-line"><span>Sous-total heures annexes</span><span className="mono">{eur(c.extraMO)}</span></div>
          <div className="total-line"><span>Total main-d'œuvre</span><span className="mono">{eur(c.moCost)}</span></div>
        </div>

        <div className="card"><h2>Forfaits et prestations</h2>
          <p className="hint" style={{ margin: '2px 0 8px' }}>Frais fixes de la commande. La remise s'applique ligne par ligne.</p>
          <div className="rows">
            <div className="row head r-forf"><span className="lbl-s">Libellé</span><span className="lbl-s" style={{ textAlign: 'right' }}>Montant</span><span className="lbl-s" style={{ textAlign: 'right' }}>Remise</span><span className="lbl-s" style={{ textAlign: 'right' }}>Net</span><span></span></div>
            {d.forfaits.map((x, i) => (
              <div className="row r-forf" key={i}>
                <span className="lbl"><Txt path={`draft.forfaits.${i}.label`} label="Libellé du forfait" ph="ex. Création recette" /></span>
                <Num path={`draft.forfaits.${i}.amount`} label={`Montant du forfait ${i + 1}`} dec />
                <div className="with-unit"><Num path={`draft.forfaits.${i}.disc`} label={`Remise sur le forfait ${i + 1}`} /><span style={noMin}>%</span></div>
                <span className="out">{eur(c.forfaits[i] ? c.forfaits[i].net : 0)}</span>
                <button className="icon-btn" aria-label="Retirer le forfait" title="Retirer" onClick={() => mutate((st) => { st.draft.forfaits.splice(i, 1); })}>×</button>
              </div>
            ))}
          </div>
          {!d.forfaits.length && <p className="empty" style={{ padding: '6px 0' }}>Aucun forfait.</p>}
          <div className="addrow"><button className="btn sm" onClick={() => mutate((st) => { st.draft.forfaits.push({ label: '', amount: 0, disc: 0 }); })}>Ajouter un forfait</button>{presets}</div>
          <div className="total-line"><span>Total forfaits (net)</span><span className="mono">{eur(c.forfaitTotal)}</span></div>
        </div>

        <div className="card"><h2>Livraison</h2>
          <div className="fields" style={{ marginTop: 12 }}><div className="field"><label className="lbl-s" htmlFor="f-draft-delivery">Facturation</label><Sel path="draft.delivery" opts={[['case', 'À la caisse (fûts à la palette)'], ['pallet', 'À la palette'], ['none', 'Sans livraison']]} label="Mode de livraison" /></div></div>
          <div className="rows" style={{ marginTop: 10 }}>
            {FORMATS.map((f) => {
              const x = c.fm[f.key];
              return (
                <div className="row r-deliv" key={f.key}>
                  <span className="lbl">{f.label}</span>
                  <span className="out">{x.units > 0 ? `${f.caseable ? `${fnum(x.cases, 0)} ${plural(x.cases, 'caisse')} · ` : ''}${fnum(x.pallets, 0)} ${plural(x.pallets, 'palette')} → ${eur(x.deliv)}` : '—'}</span>
                </div>
              );
            })}
          </div>
          <div className="sub-line"><span>Caisses · palettes générées</span><span className="mono">{fnum(c.casesTotal, 0)} · {fnum(c.palletsTotal, 0)}</span></div>
          <div className="total-line"><span>Total livraison</span><span className="mono">{eur(c.delivTotal)}</span></div>
          <p className="note">Tarifs et colisage : onglet Paramètres. Les palettes sont comptées par format, arrondies à la palette entière.</p>
        </div>

        <div className="card"><h2>Marge commerciale</h2>
          <div className="fields" style={{ marginTop: 12 }}>
            <div className="field"><label className="lbl-s" htmlFor="f-draft-margin">Marge souhaitée</label><div className="with-unit"><Num path="draft.margin" label="Marge" /><span style={noMin}>%</span></div></div>
            <div className="field"><label className="lbl-s" htmlFor="f-draft-marginMode">Calculée</label><Sel path="draft.marginMode" opts={[['markup', 'En plus du coût de revient'], ['margin', 'Sur le prix de vente']]} label="Mode de calcul de la marge" /></div>
          </div>
          <p className="note">En plus du coût : coût × (1 + marge). Sur le prix de vente : coût ÷ (1 − marge).</p>
        </div>
      </div>

      <div className="aside">
        <div className="card" id="results"><ResultsCard c={c} /></div>
        <div className="card">
          <div className="btn-row">
            <button className="btn primary" onClick={saveRecipe}>Enregistrer la recette</button>
            <button className="btn" onClick={() => { mutate((st) => { st.draft = blankRecipe(); }); top(); }}>Nouvelle recette</button>
          </div>
          <p className="note">Les montants se recalculent avec les paramètres en vigueur.</p>
        </div>
        <div className="card">
          <h2>Import et export</h2>
          <h3 style={{ marginTop: 12 }}>Recette en cours</h3>
          <div className="btn-row">
            <button className="btn" onClick={exportRecipeJson}>Exporter la recette (JSON)</button>
            <button className="btn" onClick={() => { const n = slug(getState().draft.name || 'recette') || 'recette'; saveFile(`${n}.csv`, draftCSV(getState()), true); }}>Exporter la recette (CSV)</button>
            <button className="btn" onClick={() => importRecipeRef.current?.click()}>Importer une recette</button>
          </div>
          <h3 style={{ marginTop: 14 }}>Toute la base</h3>
          <div className="btn-row">
            <button className="btn" onClick={() => saveFile('sauvegarde-calculateur-brassin.json', JSON.stringify(getState(), null, 1), false)}>Sauvegarder toute la base</button>
            <button className="btn" onClick={() => importRef.current?.click()}>Restaurer une sauvegarde</button>
          </div>
          <input type="file" ref={importRecipeRef} accept=".json,application/json" style={{ display: 'none' }}
            onChange={(ev) => { const f = ev.target.files?.[0]; if (f) onImportRecipe(f); ev.target.value = ''; }} />
          <input type="file" ref={importRef} accept=".json,application/json" style={{ display: 'none' }}
            onChange={(ev) => { const f = ev.target.files?.[0]; if (f) onImportBackup(f); ev.target.value = ''; }} />
          <p className="note">Le JSON d'une recette embarque ses ingrédients, son volume et ses profils : à l'import, ceux qui manquent dans votre base sont ajoutés. La sauvegarde complète contient toutes les recettes et tous les paramètres.</p>
        </div>
        <div className="card">
          <h2>Recettes enregistrées</h2>
          <div className="saved">
            {!state.recipes.length && <p className="empty">Aucune recette enregistrée. Remplissez le formulaire puis cliquez sur « Enregistrer la recette ».</p>}
            {state.recipes.map((r) => {
              const rc = compute(r, s);
              return (
                <div className="it" key={r.id as string}>
                  <div className="nm"><b>{r.name || 'Recette sans nom'}{r.example && <span className="badge">Exemple</span>}</b><span>{fnum(rc.netHl)} hl nets · {fnum(num(r.plato))} °P · {eur(rc.priceHlHT)} / HL HTVA</span></div>
                  <div className="btn-row">
                    <button className="btn sm" onClick={() => { mutate((st) => { const f = st.recipes.find((x) => x.id === r.id); if (f) st.draft = clone(f); }); top(); toast('Recette chargée'); }}>Charger</button>
                    <button className="btn sm" onClick={() => { mutate((st) => { const f = st.recipes.find((x) => x.id === r.id); if (!f) return; st.draft = clone(f); st.draft.id = null; st.draft.example = false; st.draft.name = (f.name || 'Recette') + ' (copie)'; }); top(); toast('Copie prête : modifiez puis enregistrez'); }}>Dupliquer</button>
                    <ConfirmButton className="btn sm danger" confirmText="Confirmer" onConfirm={() => mutate((st) => {
                      st.recipes = st.recipes.filter((x) => x.id !== r.id);
                      if (st.draft.id === r.id) st.draft.id = null;
                      if (st.selected === r.id) st.selected = st.recipes[0] ? st.recipes[0].id : null;
                    })}>Supprimer</ConfirmButton>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ====================================================================
   Comparatif, grille tarifaire, simulateur de promotion : modèles de données
   ==================================================================== */
function cmpRecipes(st: AppState): (Recipe | null)[] {
  const get = (id: string | null) => st.recipes.find((r) => r.id === id) || null;
  return [get(st.selected), get(st.cmpB), get(st.cmpC)];
}
interface Cell { t?: string; v?: number | null; sub?: string }
type CmpRow =
  | { sec: string }
  | { subsec: string }
  | { label: string; fmt: string; strong?: boolean; indent?: boolean; cells: Cell[] };

function buildCompare(st: AppState) {
  const s = st.settings;
  const calcs = cmpRecipes(st).map((r) => r ? { r, c: compute(r, s) } : null);
  const live = calcs.filter(Boolean) as { r: Recipe; c: Calc }[];
  const used = FORMATS.filter((f) => live.some((x) => x.c.fm[f.key].share > 0));
  const rows: CmpRow[] = [];
  const sec = (label: string) => rows.push({ sec: label });
  const sub = (label: string) => rows.push({ subsec: label });
  const row = (label: string, fn: (c: Calc, r: Recipe) => Cell, fmt: string, strong?: boolean, indent?: boolean) =>
    rows.push({ label, fmt, strong, indent, cells: calcs.map((x) => x ? fn(x.c, x.r) : {}) });
  const ifUsed = (f: Format, fn: (x: FmtCalc) => Cell) => (c: Calc): Cell => c.fm[f.key].share > 0 ? fn(c.fm[f.key]) : {};
  sec('Recette');
  row('Volume', (c, r) => ({ t: (volOf(r, s) || { label: '' }).label || '—' }), 'txt');
  row('Volume net', (c) => ({ v: c.netHl }), 'hl');
  row('Haute densité', (c) => ({ t: c.hd ? 'Oui' : 'Non' }), 'txt');
  row('Degré Plato', (c, r) => ({ v: num(r.plato) }), 'plato');
  row('Marge', (c, r) => ({ t: `${fnum(num(r.margin), 2)} % ${r.marginMode === 'margin' ? 'sur prix' : 'sur coût'}` }), 'txt');
  sec('Décomposition des coûts, par brassin');
  ([['Ingrédients', 'ingrCost'], ['Main-d\'œuvre', 'moCost'], ['Énergie et eau', 'energyCost'], ['Consommables', 'consTotal'], ['Taxes et accises', 'taxTotal'], ['Forfaits et prestations', 'forfaitTotal'], ['Livraison', 'delivTotal']] as const)
    .forEach(([l, k]) => row(l, (c) => ({ v: c[k], sub: c.total > 0 ? pct(c[k] / c.total) : '' }), 'eur'));
  row('Total', (c) => ({ v: c.total }), 'eur', true);
  sec('Coût de revient, sans marge');
  row('Par brassin', (c) => ({ v: c.total }), 'eur');
  row('Par HL', (c) => ({ v: c.perHl }), 'eur');
  used.forEach((f) => row(`Par ${f.unit} · ${f.label}`, ifUsed(f, (x) => ({ v: x.unitCost })), 'eur'));
  used.filter((f) => f.caseable).forEach((f) => row(`Caisse de ${num(s.perCase[f.key]) || 24} · ${f.label}`, ifUsed(f, (x) => ({ v: x.caseCost })), 'eur'));
  sec('Prix de vente avec marge');
  row('Par brassin, HTVA', (c) => ({ v: c.priceHT }), 'eur');
  row('Par brassin, TVAC', (c) => ({ v: c.priceTTC }), 'eur');
  row('Par HL, HTVA', (c) => ({ v: c.priceHlHT }), 'eur');
  row('Par HL, TVAC', (c) => ({ v: c.priceHlTTC }), 'eur');
  used.forEach((f) => {
    sub(f.long);
    row(`Par ${f.unit}, HTVA`, ifUsed(f, (x) => ({ v: x.unitHT })), 'eur', false, true);
    row(`Par ${f.unit}, TVAC`, ifUsed(f, (x) => ({ v: x.unitTTC })), 'eur', false, true);
    if (f.caseable) {
      const n = num(s.perCase[f.key]) || 24;
      row(`Par caisse de ${n}, HTVA`, ifUsed(f, (x) => ({ v: x.caseHT })), 'eur', false, true);
      row(`Par caisse de ${n}, TVAC`, ifUsed(f, (x) => ({ v: x.caseTTC })), 'eur', false, true);
    }
  });
  return { calcs, rows };
}
function cellText(cell: Cell, fmt: string): string {
  if (cell.t != null) return cell.t;
  if (cell.v == null || !isFinite(cell.v)) return '—';
  if (fmt === 'eur') return eur(cell.v);
  if (fmt === 'hl') return fnum(cell.v) + ' hl';
  if (fmt === 'plato') return fnum(cell.v) + ' °P';
  return String(cell.v);
}

function promoText(p: Promo): string {
  if (p.scheme === '5+1') return '5 + 1 gratuit : le client paie 5 pièces sur 6';
  if (p.scheme === '10+1') return '10 + 1 gratuit : le client paie 10 pièces sur 11';
  if (p.scheme === 'xy') return `${fnum(num(p.x), 2)} + ${fnum(num(p.y), 2)} gratuits : le client paie ${fnum(num(p.x), 2)} pièces sur ${fnum(num(p.x) + num(p.y), 2)}`;
  if (p.scheme === 'pct') return `Remise de ${fnum(num(p.pct), 2)} % sur le prix`;
  return 'Aucune promotion';
}
function promoModel(st: AppState) {
  const r = st.recipes.find((x) => x.id === st.selected); if (!r) return null;
  const s = st.settings, c = compute(r, s), p = st.promo;
  const ch = s.channels.find((x) => x.id === p.channel) || s.channels[0];
  const fac = chFactor(ch, s), pf = promoFactor(p);
  const rows = FORMATS.filter((f) => c.fm[f.key].share > 0).map((f) => {
    const x = c.fm[f.key];
    const nHT = x.unitHT * fac, eHT = nHT * pf;
    return {
      f, cost: x.unitCost, nHT, nTTC: nHT * c.vat, eHT, eTTC: eHT * c.vat,
      cHT: f.caseable ? eHT * x.perCase : null as number | null, cTTC: f.caseable ? eHT * x.perCase * c.vat : null as number | null,
      perCase: x.perCase, margin: x.unitCost > 0 ? eHT / x.unitCost - 1 : NaN,
    };
  });
  return { r, c, ch, pf, rows };
}

/* ====================================================================
   Exports CSV
   ==================================================================== */
const csvNum = (v: number) => String(Math.round(v * 10000) / 10000).replace('.', ',');
function toCSV(rows: unknown[][]): string {
  return rows.map((r) => r.map((v) => {
    if (typeof v === 'number') return isFinite(v) ? csvNum(v) : '';
    const t = String(v == null ? '' : v);
    return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }).join(';')).join('\r\n');
}
function draftCSV(st: AppState): string {
  const d = st.draft, s = st.settings, c = compute(d, s);
  const used = FORMATS.filter((f) => c.fm[f.key].share > 0);
  const out: unknown[][] = [];
  out.push(['Recette', d.name || 'Sans nom'], ['Volume', (volOf(d, s) || { label: '' }).label || ''], ['Haute densité', c.hd ? 'Oui' : 'Non'], ['Volume net (hl)', c.netHl],
    ['Degré Plato (°P)', num(d.plato)], ['Marge (%)', num(d.margin)], ['Mode de marge', d.marginMode === 'margin' ? 'Sur le prix de vente' : 'En plus du coût de revient'], ['TVA (%)', num(s.vat)], []);
  out.push(['Ingrédient', 'Quantité (kg)', 'Prix (€/kg)', 'Coût (€)']);
  c.ingr.forEach((x) => out.push([x.ing ? x.ing.name : '(supprimé)', x.qty, x.price, x.cost]));
  out.push([], ['Énergie et eau', 'Quantité', 'Coût (€)'], ['Eau (m³)', c.enQ.eau, c.en.eau], ['Gaz (m³)', c.enQ.gaz, c.en.gaz], ['Électricité (kWh)', c.enQ.elec, c.en.elec], []);
  out.push(['Main-d\'œuvre', 'Heures', 'Taux (€/h)', 'Coût (€)'],
    ['Brassage', c.L.brew.hours, c.L.brew.rate, c.L.brew.cost],
    ['Soutirage bouteilles, aidant 1', c.L.bot1.hours, c.L.bot1.rate, c.botShare > 0 ? c.L.bot1.cost : 0],
    ['Soutirage bouteilles, aidant 2', c.L.bot2.hours, c.L.bot2.rate, c.botShare > 0 ? c.L.bot2.cost : 0],
    ['Soutirage fûts', c.L.keg.hours, c.L.keg.rate, c.kegMO]);
  c.extras.forEach((x) => out.push(['Heures annexes : ' + (x.label || 'sans libellé'), x.hours, x.rate, x.cost]));
  out.push(['Total main-d\'œuvre', '', '', c.moCost], []);
  out.push(['Forfaits et prestations', 'Montant (€)', 'Remise (%)', 'Net (€)']);
  c.forfaits.forEach((x) => out.push([x.label || 'Sans libellé', x.amount, x.disc, x.net]));
  out.push(['Total forfaits', '', '', c.forfaitTotal], []);
  out.push(['Livraison', 'Caisses', 'Palettes', 'Coût (€)']);
  used.forEach((f) => { const x = c.fm[f.key]; out.push([f.label, x.cases, x.pallets, x.deliv]); });
  out.push(['Total livraison', c.casesTotal, c.palletsTotal, c.delivTotal], []);
  const T = c.total;
  out.push(['Décomposition des coûts', '€ par brassin', 'Part'],
    ['Ingrédients', c.ingrCost, T ? c.ingrCost / T : 0], ['Main-d\'œuvre', c.moCost, T ? c.moCost / T : 0], ['Énergie et eau', c.energyCost, T ? c.energyCost / T : 0],
    ['Consommables', c.consTotal, T ? c.consTotal / T : 0], ['Taxes et accises', c.taxTotal, T ? c.taxTotal / T : 0],
    ['Forfaits et prestations', c.forfaitTotal, T ? c.forfaitTotal / T : 0], ['Livraison', c.delivTotal, T ? c.delivTotal / T : 0], ['Total (coût de revient)', T, 1], [],
    ['Coût de revient par HL', c.perHl], ['Prix de vente par brassin HTVA', c.priceHT], ['Prix de vente par brassin TVAC', c.priceTTC],
    ['Prix de vente par HL HTVA', c.priceHlHT], ['Prix de vente par HL TVAC', c.priceHlTTC], []);
  out.push(['Format', 'Part du volume', 'Litres', 'Pièces', 'Taxes par pièce', 'Coût par pièce', 'Coût par caisse', 'Prix pièce HTVA', 'Prix pièce TVAC', 'Prix caisse HTVA', 'Prix caisse TVAC']);
  used.forEach((f) => { const x = c.fm[f.key]; out.push([f.long, x.share, x.liters, x.units, x.taxUnit, x.unitCost, f.caseable ? x.caseCost : '', x.unitHT, x.unitTTC, f.caseable ? x.caseHT : '', f.caseable ? x.caseTTC : '']); });
  out.push([], ['Grille tarifaire (prix par pièce)', 'Remise', ...used.flatMap((f) => [f.label + ' HTVA', f.label + ' TVAC'])]);
  s.channels.forEach((ch) => { const fac = chFactor(ch, s); out.push([ch.name, num(ch.pct), ...used.flatMap((f) => { const ht = c.fm[f.key].unitHT * fac; return [ht, ht * c.vat]; })]); });
  return toCSV(out);
}
function compareCSV(st: AppState): string {
  const { calcs, rows } = buildCompare(st);
  const out: unknown[][] = [['', ...calcs.filter(Boolean).map((x) => (x as { r: Recipe }).r.name || 'Sans nom')]];
  rows.forEach((r) => {
    if ('sec' in r) out.push([r.sec]);
    else if ('subsec' in r) out.push([r.subsec]);
    else out.push([r.label, ...r.cells.filter((_, i) => calcs[i]).map((c) => c.t != null ? c.t : (c.v == null || !isFinite(c.v) ? '' : c.v))]);
  });
  const m = promoModel(st);
  if (m && m.rows.length) {
    out.push([], ['Simulateur de promotion : ' + (m.r.name || 'Sans nom')], ['Promotion', promoText(st.promo)], ['Canal', m.ch ? m.ch.name : ''], ['Remise effective (%)', (1 - m.pf) * 100], []);
    out.push(['Format', 'Prix normal pièce HTVA', 'Prix normal pièce TVAC', 'Prix effectif pièce HTVA', 'Prix effectif pièce TVAC', 'Prix effectif caisse HTVA', 'Prix effectif caisse TVAC', 'Coût de revient pièce', 'Marge réelle (%)']);
    m.rows.forEach((x) => out.push([x.f.label, x.nHT, x.nTTC, x.eHT, x.eTTC, x.cHT == null ? '' : x.cHT, x.cTTC == null ? '' : x.cTTC, x.cost, isFinite(x.margin) ? x.margin * 100 : '']));
  }
  return toCSV(out);
}

/* ====================================================================
   ONGLET 3 : Comparateur et promotions
   ==================================================================== */
function CompareTab({ gridUnit, setGridUnit }: { gridUnit: 'piece' | 'case'; setGridUnit: (u: 'piece' | 'case') => void }) {
  const { state, mutate, saveFile } = useCb();
  const s = state.settings;
  const { calcs, rows } = useMemo(() => buildCompare(state), [state]);
  const opt = (r: Recipe) => <option key={r.id as string} value={r.id as string}>{(r.name || 'Sans nom') + (r.example ? ' (exemple)' : '')}</option>;
  const selects: { id: 'cmp-a' | 'cmp-b' | 'cmp-c'; label: string; key: 'selected' | 'cmpB' | 'cmpC'; none: boolean }[] = [
    { id: 'cmp-a', label: 'Recette A (principale)', key: 'selected', none: false },
    { id: 'cmp-b', label: 'Recette B', key: 'cmpB', none: true },
    { id: 'cmp-c', label: 'Recette C', key: 'cmpC', none: true },
  ];

  /* grille tarifaire (recette A) */
  const gridRecipe = state.recipes.find((x) => x.id === state.selected) || null;
  const gc = gridRecipe ? compute(gridRecipe, s) : null;
  const gFmts = gc ? FORMATS.filter((f) => gc.fm[f.key].share > 0) : [];
  const isCase = gridUnit === 'case';

  /* promotion */
  const p = state.promo;
  const pm = useMemo(() => promoModel(state), [state]);

  return (
    <>
      <div className="sec-title"><h2>Comparatif de trois recettes</h2><button className="btn sm" onClick={() => saveFile('comparatif-recettes.csv', compareCSV(state), true)}>Exporter en CSV (Excel)</button></div>
      <div className="card">
        <div className="toolbar">
          {selects.map((sl) => (
            <div className="field" key={sl.id}>
              <label className="lbl-s" htmlFor={sl.id}>{sl.label}</label>
              <select id={sl.id} value={state[sl.key] || ''} onChange={(e) => { const v = e.target.value; mutate((st) => { st[sl.key] = v; }); }}>
                {sl.none && <option value="">— Aucune —</option>}
                {state.recipes.map(opt)}
              </select>
            </div>
          ))}
        </div>
        <div className="scroll" id="cmp-root">
          {!state.recipes.length ? <p className="empty">Aucune recette enregistrée. Créez-en une dans l'onglet Recette, puis enregistrez-la pour la comparer ici.</p> : (
            <table className="cmp">
              <thead>
                <tr><th></th>{calcs.map((x, i) => (
                  <th key={i}><span className="th-sub">Recette {'ABC'[i]}{i === 0 ? ' · principale' : ''}</span>
                    {x ? <>{x.r.name || 'Sans nom'}{x.r.example && <span className="badge">Exemple</span>}<small>{fnum(x.c.netHl)} hl nets · {fnum(num(x.r.plato))} °P</small></> : '—'}
                  </th>
                ))}</tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => {
                  if ('sec' in r) return <tr className="sec" key={ri}><td colSpan={calcs.length + 1}>{r.sec}</td></tr>;
                  if ('subsec' in r) return <tr className="subsec" key={ri}><td colSpan={calcs.length + 1}>{r.subsec}</td></tr>;
                  return (
                    <tr className={r.strong ? 'strong' : ''} key={ri}>
                      <td className={r.indent ? 'sub-l' : ''}>{r.label}</td>
                      {r.cells.map((cell, ci) => {
                        const t = cellText(cell, r.fmt);
                        return <td className={'n' + (t === '—' ? ' na' : '')} key={ci}>{t}{cell.sub ? <small>{cell.sub}</small> : null}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="sec-title"><h2>Grille tarifaire par canal de vente</h2><p>Prix calculés avec la marge de la recette</p></div>
      <div className="card">
        <div className="toolbar">
          <div className="field"><span className="lbl-s">Recette principale (A)</span><b id="grid-name">{gridRecipe ? (gridRecipe.name || 'Sans nom') : '—'}</b></div>
          <div className="seg" role="group" aria-label="Unité de prix">
            <button type="button" aria-pressed={!isCase} onClick={() => setGridUnit('piece')}>Par pièce</button>
            <button type="button" aria-pressed={isCase} onClick={() => setGridUnit('case')}>Par caisse</button>
          </div>
        </div>
        <div className="scroll" id="grid-root">
          {!gridRecipe || !gc ? <p className="empty">Enregistrez une recette pour afficher sa grille tarifaire.</p>
            : !gFmts.length ? <p className="empty">Cette recette n'a aucun format de conditionnement.</p> : (
              <table className="price-grid">
                <thead>
                  <tr><th>Canal</th><th>Remise</th>{gFmts.map((f) => {
                    const x = gc.fm[f.key];
                    return <th key={f.key}>{isCase && f.caseable ? `Caisse de ${x.perCase} · ${f.label}` : f.label}<span className="th-sub">TVAC / HTVA</span></th>;
                  })}</tr>
                </thead>
                <tbody>
                  {s.channels.map((ch) => {
                    const fac = chFactor(ch, s);
                    const below = gc.k * fac < 1 - 1e-9;
                    const base = s.channels.find((x) => x.id === ch.base);
                    const rem = base ? `−${fnum(num(ch.pct), 2)} % sur ${base.name}` : (num(ch.pct) ? `−${fnum(num(ch.pct), 2)} %` : '—');
                    return (
                      <tr key={ch.id}>
                        <td>{ch.name}{below && <> <span className="badge">sous le coût</span></>}</td>
                        <td className="n" style={{ color: 'var(--muted)' }}>{rem}</td>
                        {gFmts.map((f) => {
                          const x = gc.fm[f.key];
                          const ht = (isCase && f.caseable ? x.caseHT : x.unitHT) * fac, ttc = ht * gc.vat;
                          return <td key={f.key} className={'cell' + (below ? ' below' : '') + (ch.id === 'part' ? ' part' : '')}><b>{eur(ttc)}</b><small>{eur(ht)}</small></td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
        <p className="note">Les cellules sur fond ambré sont vendues sous le coût de revient. Les canaux et leurs remises se règlent dans l'onglet Paramètres.</p>
      </div>

      <div className="sec-title"><h2>Simulateur de promotion</h2><p>Pour la recette principale (A)</p></div>
      <div className="card">
        <div className="toolbar">
          <div className="field"><label className="lbl-s" htmlFor="f-promo-channel">Canal de vente</label>
            <Sel path="promo.channel" opts={s.channels.map((c): [string, string] => [c.id, c.name])} label="Canal de vente" /></div>
          <div className="field"><label className="lbl-s" htmlFor="f-promo-scheme">Schéma promotionnel</label>
            <Sel path="promo.scheme" label="Schéma promotionnel" opts={[['5+1', '5 + 1 gratuit'], ['10+1', '10 + 1 gratuit'], ['xy', 'X + Y gratuits (personnalisé)'], ['pct', 'Remise en % (personnalisée)'], ['none', 'Aucune promotion']]} /></div>
          {p.scheme === 'xy' && (
            <div className="field" id="promo-xy"><span className="lbl-s">Achetés + offerts</span>
              <div className="with-unit"><Num path="promo.x" label="Pièces achetées" min={0} /><span style={noMin}>+</span><Num path="promo.y" label="Pièces offertes" min={0} /></div></div>
          )}
          {p.scheme === 'pct' && (
            <div className="field" id="promo-pct"><span className="lbl-s">Remise</span>
              <div className="with-unit"><Num path="promo.pct" label="Remise en pourcentage" min={0} /><span>%</span></div></div>
          )}
        </div>
        {pm && pm.rows.length > 0 && <div id="promo-sum"><p style={{ margin: '0 0 10px' }}><b>{promoText(p)}</b> · {pm.ch ? pm.ch.name : ''} · remise effective {pct(1 - pm.pf)}</p></div>}
        <div className="scroll" id="promo-root">
          {!pm ? <p className="empty">Enregistrez une recette pour simuler une promotion.</p>
            : !pm.rows.length ? <p className="empty">Cette recette n'a aucun format de conditionnement.</p> : (
              <table className="promo-tbl">
                <thead><tr><th>Format</th><th>Prix normal<span className="th-sub">pièce · TVAC / HTVA</span></th><th>Prix effectif<span className="th-sub">pièce · TVAC / HTVA</span></th><th>Prix effectif<span className="th-sub">caisse · TVAC / HTVA</span></th><th>Coût de revient<span className="th-sub">pièce</span></th><th>Marge réelle<span className="th-sub">sur coût</span></th></tr></thead>
                <tbody>
                  {pm.rows.map((x) => {
                    const below = x.margin < -1e-9;
                    const cls = below ? ' below' : '';
                    return (
                      <tr key={x.f.key}>
                        <td>{x.f.label}</td>
                        <td className="cell"><b>{eur(x.nTTC)}</b><small>{eur(x.nHT)}</small></td>
                        <td className={'cell eff' + cls}><b>{eur(x.eTTC)}</b><small>{eur(x.eHT)}</small></td>
                        <td className={'cell eff' + cls}>{x.f.caseable ? <><b>{eur(x.cTTC)}</b><small>{eur(x.cHT)}</small><small>caisse de {x.perCase}</small></> : <><b>—</b><small>pas de caisse</small></>}</td>
                        <td className="n">{eur(x.cost)}</td>
                        <td className={'n' + (below ? ' below' : '')} style={below ? { color: 'var(--warn)', fontWeight: 600 } : undefined}>{isFinite(x.margin) ? pct(x.margin) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
        <p className="note">Le prix effectif est le prix du canal multiplié par la part réellement payée. La marge réelle se compare au coût de revient de chaque format.</p>
      </div>
    </>
  );
}

/* ====================================================================
   Page
   ==================================================================== */
const CSS = `@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
.cb-root{--bg:#F2F4EC; --surface:#FFFFFF; --surface-2:#E9EDE0; --ink:#1A2217; --muted:#58634F; --line:#D5DCC9;
  --accent:#3B6A26; --accent-ink:#FFFFFF; --accent-soft:#E0EBD3;
  --warn:#8F5C00; --warn-soft:#FBEED0; --bad:#A22E22; --bad-soft:#F7DDD8;
  --c1:#5C8F3A; --c2:#3F7396; --c3:#C28A1E; --c4:#8B67B5; --c5:#B5503C; --c6:#2F8A83; --c7:#7B8470;
  --font-display:'Bricolage Grotesque',system-ui,-apple-system,'Segoe UI',sans-serif;
  --font-body:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif;
  --font-mono:'IBM Plex Mono',ui-monospace,'SFMono-Regular',Menlo,monospace;}
.cb-root,.cb-root *{box-sizing:border-box}
.cb-root{background:var(--bg);color:var(--ink);font-family:var(--font-body);font-size:14px;line-height:1.45;
  padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:0 40px}
.cb-root h1,.cb-root h2,.cb-root h3{font-family:var(--font-display);margin:0;text-wrap:balance;font-weight:600}
.cb-root button,.cb-root input,.cb-root select{font:inherit;color:inherit}
.cb-root .wrap{max-width:1320px;margin:0 auto}
.cb-root .top{position:sticky;top:env(safe-area-inset-top,0px);z-index:9;background:var(--bg);border-bottom:1px solid var(--line);margin-inline:calc(-1 * max(16px,env(safe-area-inset-left,0px))) calc(-1 * max(16px,env(safe-area-inset-right,0px)));
  padding-inline:max(16px,env(safe-area-inset-left,0px)) max(16px,env(safe-area-inset-right,0px))}
.cb-root .top-in{max-width:1320px;margin:0 auto;display:flex;flex-wrap:wrap;align-items:flex-end;gap:6px 24px;padding-top:12px}
.cb-root .brand{display:flex;flex-direction:column;padding-bottom:8px;min-width:0}
.cb-root .brand h1{font-size:19px;letter-spacing:-.01em}
.cb-root .brand span{font-size:12px;color:var(--muted)}
.cb-root .tabs{display:flex;gap:2px;flex:1 1 auto;min-width:0}
.cb-root .tab-btn{appearance:none;background:none;border:0;border-bottom:3px solid transparent;padding:10px 14px 9px;cursor:pointer;font-weight:500;color:var(--muted);white-space:nowrap}
.cb-root .tab-btn[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--accent)}
.cb-root .tab-btn:hover{color:var(--ink)}
.cb-root .state{margin-left:auto;display:flex;align-items:center;gap:8px;padding-bottom:8px;font-size:12px;color:var(--muted)}
.cb-root .state .dot{width:8px;height:8px;border-radius:50%;background:var(--accent)}
.cb-root .state.off .dot{background:var(--warn)}
.cb-root main{padding-top:20px}
.cb-root .tab[hidden]{display:none}
.cb-root .grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));align-items:start}
.cb-root .split{display:grid;gap:20px;grid-template-columns:minmax(0,1fr) minmax(0,460px);align-items:start}
.cb-root .split>*{min-width:0}
.cb-root .stack{display:flex;flex-direction:column;gap:16px;min-width:0}
.cb-root .card{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:16px;min-width:0}
.cb-root .card>h2{font-size:15px}
.cb-root .card h3{font-size:13px;margin-bottom:8px}
.cb-root .sec-title{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 12px;margin:26px 0 10px}
.cb-root .sec-title:first-child{margin-top:0}
.cb-root .sec-title h2{font-size:17px}
.cb-root .sec-title p{margin:0;color:var(--muted);font-size:12px}
.cb-root .lbl-s{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600}
.cb-root .fields{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr))}
.cb-root .field{display:flex;flex-direction:column;gap:5px;min-width:0}
.cb-root .hint{font-size:12px;color:var(--muted)}
.cb-root input,.cb-root select{background:var(--surface);border:1px solid var(--line);border-radius:4px;height:32px;padding:0 8px;width:100%;min-width:0}
.cb-root input.num{text-align:right;font-family:var(--font-mono);font-size:13px;font-variant-numeric:tabular-nums}
.cb-root input[type="checkbox"]{width:18px;height:18px;padding:0;accent-color:var(--accent)}
.cb-root input:hover,.cb-root select:hover{border-color:var(--muted)}
.cb-root input:focus-visible,.cb-root select:focus-visible,.cb-root button:focus-visible,.cb-root summary:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.cb-root .with-unit{display:flex;align-items:center;gap:6px;min-width:0}
.cb-root .with-unit span{font-size:12px;color:var(--muted);white-space:nowrap;min-width:34px}
.cb-root .btn{appearance:none;border:1px solid var(--line);background:var(--surface);border-radius:4px;height:34px;padding:0 14px;cursor:pointer;font-weight:500;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}
.cb-root .btn:hover{border-color:var(--muted)}
.cb-root .btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.cb-root .btn.primary:hover{filter:brightness(1.08)}
.cb-root .btn.sm{height:28px;padding:0 10px;font-size:13px}
.cb-root .btn.danger.armed{background:var(--bad);border-color:var(--bad);color:#fff}
.cb-root .icon-btn{appearance:none;background:none;border:1px solid transparent;border-radius:4px;width:30px;height:30px;cursor:pointer;color:var(--muted);font-size:16px;line-height:1}
.cb-root .icon-btn:hover{color:var(--bad);border-color:var(--line)}
.cb-root .btn-row{display:flex;flex-wrap:wrap;gap:8px}
.cb-root .rows{display:flex;flex-direction:column}
.cb-root .row{display:grid;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid var(--line)}
.cb-root .row:last-child{border-bottom:0}
.cb-root .row.head{padding:0 0 4px}
.cb-root .row.plain{border:0;padding-bottom:0}
.cb-root .row .out{font-family:var(--font-mono);font-size:13px;text-align:right;font-variant-numeric:tabular-nums}
.cb-root .row .lbl{min-width:0}
.cb-root .r-ing{grid-template-columns:minmax(0,1fr) 96px 112px 30px}
.cb-root .r-rate{grid-template-columns:minmax(0,1fr) 124px 30px}
.cb-root .r-energy{grid-template-columns:minmax(0,1fr) 124px}
.cb-root .r-hd{grid-template-columns:minmax(0,1fr) 96px 96px}
.cb-root .r-base{grid-template-columns:minmax(0,1fr) 108px 30px}
.cb-root .r-excise{grid-template-columns:76px minmax(0,1fr) 30px}
.cb-root .r-cons{grid-template-columns:minmax(0,1fr) 96px 124px 30px;grid-template-areas:"n p m d"}
.cb-root .r-cons .n{grid-area:n}
.cb-root .r-cons .p{grid-area:p}
.cb-root .r-cons .m{grid-area:m}
.cb-root .r-cons .d{grid-area:d}
.cb-root .r-lab{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) 72px 108px}
.cb-root .r-extra{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) 72px 108px 30px}
.cb-root .r-forf{grid-template-columns:minmax(0,1.2fr) 104px 76px 112px 30px}
.cb-root .r-mix{grid-template-columns:minmax(0,1fr) 92px minmax(0,1.3fr)}
.cb-root .r-chan{grid-template-columns:minmax(0,1fr) minmax(0,1fr) 92px 30px;grid-template-areas:"n b p d"}
.cb-root .r-chan .n{grid-area:n}
.cb-root .r-chan .b{grid-area:b}
.cb-root .r-chan .p{grid-area:p}
.cb-root .r-chan .d{grid-area:d}
.cb-root .r-vol{grid-template-columns:minmax(0,1fr) 112px 92px 30px;grid-template-areas:"n p h d"}
.cb-root .r-vol .n{grid-area:n}
.cb-root .r-vol .p{grid-area:p}
.cb-root .r-vol .h{grid-area:h}
.cb-root .r-vol .d{grid-area:d}
.cb-root .r-en{grid-template-columns:minmax(0,1fr) 112px 120px}
.cb-root .r-colis{grid-template-columns:minmax(0,1fr) 96px 96px}
.cb-root .r-csel{grid-template-columns:22px minmax(0,1fr) auto;gap:10px}
.cb-root .r-deliv{grid-template-columns:minmax(0,1fr) auto}
.cb-root .addrow{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)}
.cb-root .addrow input{flex:1 1 110px;width:auto}
.cb-root .addrow select{flex:0 1 150px;width:auto}
.cb-root .addrow .btn{flex:0 0 auto}
.cb-root .total-line{display:flex;justify-content:space-between;gap:12px;margin-top:10px;padding-top:10px;border-top:1px solid var(--ink);font-weight:600}
.cb-root .sub-line{display:flex;justify-content:space-between;gap:12px;margin-top:8px;color:var(--muted);font-size:13px}
.cb-root .mono{font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.cb-root .badge{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:3px;background:var(--warn-soft);color:var(--warn);vertical-align:middle;margin-left:6px;white-space:nowrap}
.cb-root .note{font-size:12px;color:var(--muted);margin:8px 0 0}
.cb-root .alert{font-size:13px;padding:8px 10px;border-radius:4px;background:var(--warn-soft);color:var(--warn);margin-top:10px}
.cb-root .alert.bad{background:var(--bad-soft);color:var(--bad)}
.cb-root .cgrp{margin-top:12px}
.cb-root .cgrp:first-of-type{margin-top:6px}
.cb-root .cgrp h3{margin-bottom:2px}
.cb-root .r-csel label{cursor:pointer}
.cb-root .r-csel .pr{font-family:var(--font-mono);font-size:12px;color:var(--muted);white-space:nowrap}
.cb-root .aside{position:sticky;top:calc(var(--hh,96px) + env(safe-area-inset-top,0px) + 14px);display:flex;flex-direction:column;gap:16px;min-width:0}
.cb-root .kpis{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:12px 0 16px}
.cb-root .kpi .v{font-family:var(--font-mono);font-size:18px;font-weight:500;letter-spacing:-.02em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.cb-root .kpi .l{font-size:12px;color:var(--muted)}
.cb-root .bar{display:flex;height:12px;border-radius:2px;overflow:hidden;background:var(--surface-2);gap:2px}
.cb-root .bar i{display:block;min-width:2px}
.cb-root .legend{display:flex;flex-direction:column;gap:3px;margin-top:10px}
.cb-root .legend div{display:flex;align-items:center;gap:8px;font-size:13px}
.cb-root .legend b{width:10px;height:10px;border-radius:2px;flex:0 0 auto}
.cb-root .legend span:nth-child(3){margin-left:auto}
.cb-root .legend em{font-style:normal;color:var(--muted);font-size:12px;min-width:50px;text-align:right}
.cb-root .scroll{overflow-x:auto;max-width:100%}
.cb-root table{border-collapse:collapse;width:100%;font-size:13px}
.cb-root th,.cb-root td{padding:6px 10px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
.cb-root th:first-child,.cb-root td:first-child{text-align:left}
.cb-root thead th{font-weight:600;vertical-align:bottom}
.cb-root td.n,.cb-root th.n{font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.cb-root .fmt-tbl th,.cb-root .fmt-tbl td{padding:5px 6px;font-size:12.5px}
.cb-root .cmp{min-width:560px}
.cb-root .cmp th:first-child,.cb-root .cmp td:first-child{position:sticky;left:0;background:var(--surface);z-index:1;min-width:210px;white-space:normal}
.cb-root .cmp thead th{background:var(--surface);border-bottom:1px solid var(--ink)}
.cb-root .cmp thead th small{display:block;font-weight:400;color:var(--muted);font-size:12px}
.cb-root .cmp tr.sec td{background:var(--surface-2);font-family:var(--font-display);font-weight:600;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding-top:9px;padding-bottom:9px}
.cb-root .cmp tr.subsec td{font-weight:600;padding-top:10px;color:var(--ink);background:var(--surface)}
.cb-root .cmp tr.strong td{font-weight:700;border-top:1px solid var(--ink)}
.cb-root .cmp td small{display:block;color:var(--muted);font-size:11px;font-family:var(--font-body)}
.cb-root .cmp td.sub-l{padding-left:22px;color:var(--muted)}
.cb-root .cmp td.na{color:var(--muted)}
.cb-root .price-grid td.cell,.cb-root .promo-tbl td.cell{padding:7px 10px}
.cb-root .price-grid td.cell b,.cb-root .promo-tbl td.cell b{display:block;font-family:var(--font-mono);font-weight:500;font-size:14px}
.cb-root .price-grid td.cell small,.cb-root .promo-tbl td.cell small{display:block;font-family:var(--font-mono);color:var(--muted);font-size:12px}
.cb-root .price-grid td.below,.cb-root .promo-tbl td.below{background:var(--warn-soft)}
.cb-root .price-grid td.below b,.cb-root .price-grid td.below small,.cb-root .promo-tbl td.below b,.cb-root .promo-tbl td.below small{color:var(--warn)}
.cb-root .price-grid td.cell.part b{color:var(--accent)}
.cb-root .promo-tbl td.eff b{color:var(--accent)}
.cb-root .promo-tbl td.below.eff b{color:var(--warn)}
.cb-root .th-sub{display:block;font-weight:400;color:var(--muted);font-size:12px}
.cb-root .seg{display:inline-flex;border:1px solid var(--line);border-radius:4px;overflow:hidden}
.cb-root .seg button{appearance:none;border:0;background:var(--surface);padding:0 12px;height:32px;cursor:pointer;color:var(--muted)}
.cb-root .seg button[aria-pressed="true"]{background:var(--accent-soft);color:var(--ink);font-weight:600}
.cb-root .toolbar{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin-bottom:12px}
.cb-root .toolbar .field{min-width:0}
.cb-root .toolbar select{width:auto;min-width:190px;max-width:100%}
.cb-root .toolbar .with-unit input{width:84px}
.cb-root .saved{display:flex;flex-direction:column}
.cb-root .saved .it{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:9px 0;border-bottom:1px solid var(--line)}
.cb-root .saved .it:last-child{border-bottom:0}
.cb-root .saved .it .nm{flex:1 1 180px;min-width:0}
.cb-root .saved .it .nm b{display:block;overflow-wrap:anywhere}
.cb-root .saved .it .nm span{font-size:12px;color:var(--muted)}
.cb-root .empty{color:var(--muted);padding:14px 0;font-size:13px}
.cb-root .sheet{position:fixed;inset:0;z-index:30;background:rgba(10,14,8,.55);display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) max(16px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px))}
.cb-root .sheet[hidden]{display:none}
.cb-root .sheet .box{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:16px;width:min(720px,100%);max-height:100%;display:flex;flex-direction:column;gap:10px}
.cb-root .sheet textarea{width:100%;min-height:240px;flex:1;font-family:var(--font-mono);font-size:12px;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:4px;padding:8px;resize:vertical}
.cb-root .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:40;background:var(--ink);color:var(--bg);padding:9px 16px;border-radius:4px;font-size:13px;max-width:calc(100% - 32px)}
.cb-root .toast[hidden]{display:none}
.cb-root .x{display:inline}
@media (max-width:960px){.cb-root .split{grid-template-columns:minmax(0,1fr)}
.cb-root .aside{position:static}}
@media (max-width:640px){.cb-root .x{display:none}
.cb-root .state{display:none}
.cb-root .tabs{flex:1 1 100%;order:3}
.cb-root .tab-btn{flex:1 1 0;padding:10px 8px 9px}
.cb-root .top-in{padding-top:10px}
.cb-root .card{padding:14px}
.cb-root .r-lab{grid-template-columns:minmax(0,1fr) 72px 100px}
.cb-root .r-lab .lbl{grid-column:1/-1}
.cb-root .r-extra{grid-template-columns:minmax(0,1fr) 72px 30px}
.cb-root .r-extra .lbl{grid-column:1/-1}
.cb-root .r-extra .out{text-align:left}
.cb-root .r-forf{grid-template-columns:minmax(0,1fr) 76px 30px}
.cb-root .r-forf .lbl{grid-column:1/-1}
.cb-root .r-forf .out{grid-column:1/-1;text-align:left}
.cb-root .r-cons{grid-template-columns:minmax(0,1fr) 96px 30px;grid-template-areas:"n p d" "m m m"}
.cb-root .r-chan{grid-template-columns:minmax(0,1fr) 92px 30px;grid-template-areas:"n p d" "b b b"}
.cb-root .r-vol{grid-template-columns:minmax(0,1fr) 112px 30px;grid-template-areas:"n p d" "h h h"}
.cb-root .r-mix{grid-template-columns:minmax(0,1fr) 92px}
.cb-root .r-mix .out{grid-column:1/-1;text-align:left}
.cb-root .r-en{grid-template-columns:minmax(0,1fr) 100px}
.cb-root .r-en .out{grid-column:1/-1;text-align:left}
.cb-root .r-ing{grid-template-columns:minmax(0,1fr) 112px 30px}
.cb-root .r-ing select{grid-column:1/-1}}
@media (prefers-reduced-motion:no-preference){.cb-root .tab:not([hidden]){animation:fadein .18s ease-out}
@keyframes fadein{from{opacity:.4}to{opacity:1}}}`;

export default function CalculateurPage() {
  const [state, setState] = useState<AppState | null>(null);
  const stateRef = useRef<AppState | null>(null);
  const [tab, setTab] = useState<TabId>('params');
  const [gridUnit, setGridUnit] = useState<'piece' | 'case'>('piece');
  const [storageOk, setStorageOk] = useState(true);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [sheet, setSheet] = useState<string | null>(null);
  const sheetRef = useRef<HTMLTextAreaElement>(null);
  const [hh, setHh] = useState(96);
  const headRef = useRef<HTMLDivElement>(null);
  const ready = state !== null;

  /* chargement initial (côté navigateur uniquement : évite tout écart d'hydratation) */
  useEffect(() => {
    const st = loadState() || freshState();
    stateRef.current = st; setState(st);
    const h0 = (window.location.hash || '').replace('#', '');
    if (h0 === 'params' || h0 === 'recette' || h0 === 'compare') setTab(h0);
  }, []);

  const getState = useCallback(() => stateRef.current as AppState, []);
  /** Applique une modification sur une copie du state (même style que l'ancien code : on modifie, puis on rafraîchit). */
  const mutate = useCallback((fn: (s: AppState) => void) => {
    const cur = stateRef.current; if (!cur) return;
    const next = clone(cur); fn(next);
    stateRef.current = next; setState(next);
  }, []);
  const setAt = useCallback((path: string, v: unknown) => {
    mutate((st) => {
      setPath(st, path, v);
      if (path === 'draft.volumeId') { const vo = volOf(st.draft, st.settings); if (vo) st.draft.hd = num(vo.hd) === 1 ? 1 : 0; }
    });
  }, [mutate]);
  const toast = useCallback((m: string) => {
    setToastMsg(m); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2800);
  }, []);
  const saveFile = useCallback((filename: string, text: string, bom: boolean) => {
    try {
      const blob = new Blob([(bom ? '﻿' : '') + text], { type: bom ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast('Fichier prêt : ' + filename);
    } catch { setSheet(text); }
  }, [toast]);

  /* enregistrement automatique dans le navigateur (250 ms après la dernière modification) */
  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); setStorageOk(true); } catch { setStorageOk(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [state]);

  /* onglet actif : adresse (#params / #recette / #compare) et retour en haut de page */
  useEffect(() => {
    if (!ready) return;
    try { window.history.replaceState(null, '', '#' + tab); } catch { /* ignoré */ }
    window.scrollTo(0, 0);
  }, [tab, ready]);

  /* en-tête collant : hauteur utilisée par le panneau de résultats */
  useEffect(() => {
    if (!ready) return;
    const set = () => setHh(headRef.current ? headRef.current.offsetHeight : 96);
    set();
    window.addEventListener('resize', set);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(set);
    return () => window.removeEventListener('resize', set);
  }, [ready]);

  /* fenêtre de copie : Échap pour fermer */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* comparateur : corrige les sélections qui pointent vers une recette ou un canal supprimé */
  useEffect(() => {
    if (!state || tab !== 'compare') return;
    const has = (id: string | null) => state.recipes.some((r) => r.id === id);
    const selected = has(state.selected) ? state.selected : (state.recipes[0] ? state.recipes[0].id : null);
    const cmpB = state.cmpB && !has(state.cmpB) ? '' : state.cmpB;
    const cmpC = state.cmpC && !has(state.cmpC) ? '' : state.cmpC;
    const channel = state.settings.channels.some((c) => c.id === state.promo.channel) ? state.promo.channel : ((state.settings.channels[0] || { id: '' }).id || '');
    if (selected !== state.selected || cmpB !== state.cmpB || cmpC !== state.cmpC || channel !== state.promo.channel) {
      mutate((st) => { st.selected = selected; st.cmpB = cmpB; st.cmpC = cmpC; st.promo.channel = channel; });
    }
  }, [state, tab, mutate]);

  const ctx = useMemo<Ctx | null>(() => state ? { state, getState, mutate, setAt, toast, saveFile } : null, [state, getState, mutate, setAt, toast, saveFile]);
  const rootStyle = { '--hh': hh + 'px' } as CSSProperties;

  if (!state || !ctx) {
    return <div className="cb-root" style={{ minHeight: '60vh' }}><style dangerouslySetInnerHTML={{ __html: CSS }} /><p className="empty">Chargement du calculateur…</p></div>;
  }

  const tabs: { id: TabId; a: string; b: string }[] = [
    { id: 'params', a: 'Paramètres', b: ' & base de données' },
    { id: 'recette', a: 'Recette', b: ' & simulateur' },
    { id: 'compare', a: 'Comparateur', b: ' & promotions' },
  ];

  return (
    <CbCtx.Provider value={ctx}>
      <div className="cb-root" style={rootStyle}>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="top" id="top" ref={headRef}>
          <div className="top-in">
            <div className="brand">
              <h1>Calculateur de brassin</h1>
              <span>Bière à façon · coût de revient et prix de vente</span>
            </div>
            <div className="tabs" role="tablist" aria-label="Sections">
              {tabs.map((t) => (
                <button key={t.id} className="tab-btn" role="tab" id={'tb-' + t.id} aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.a}<span className="x">{t.b}</span></button>
              ))}
            </div>
            <div className={'state' + (storageOk ? '' : ' off')} id="save-state" role="status"><span className="dot"></span><span id="save-text">{storageOk ? 'Enregistré dans ce navigateur' : 'Stockage indisponible : exportez une sauvegarde'}</span></div>
          </div>
        </div>

        <main className="wrap">
          {tab === 'params' && <section className="tab" id="tab-params" role="tabpanel" aria-labelledby="tb-params"><SettingsTab /></section>}
          {tab === 'recette' && <section className="tab" id="tab-recette" role="tabpanel" aria-labelledby="tb-recette"><RecipeTab /></section>}
          {tab === 'compare' && <section className="tab" id="tab-compare" role="tabpanel" aria-labelledby="tb-compare"><CompareTab gridUnit={gridUnit} setGridUnit={setGridUnit} /></section>}
        </main>

        {sheet !== null && (
          <div className="sheet" id="sheet">
            <div className="box" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
              <h2 id="sheet-title" style={{ fontSize: 16 }}>Copier le fichier</h2>
              <p className="hint">L'enregistrement direct n'est pas disponible ici. Copiez le texte puis collez-le dans un fichier .csv ou dans Excel.</p>
              <textarea id="sheet-text" ref={sheetRef} readOnly value={sheet} aria-label="Contenu du fichier" autoFocus />
              <div className="btn-row">
                <button className="btn primary" onClick={() => {
                  const ta = sheetRef.current; if (ta) ta.select();
                  const ok = () => toast('Copié');
                  const fallback = () => { try { document.execCommand('copy'); ok(); } catch { toast('Sélectionnez le texte puis copiez-le'); } };
                  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(sheet).then(ok, fallback); else fallback();
                }}>Copier</button>
                <button className="btn" onClick={() => setSheet(null)}>Fermer</button>
              </div>
            </div>
          </div>
        )}
        {toastMsg && <div className="toast" id="toast" role="status">{toastMsg}</div>}
      </div>
    </CbCtx.Provider>
  );
}
