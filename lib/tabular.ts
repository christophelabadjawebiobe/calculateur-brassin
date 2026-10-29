// lib/tabular.ts : lecture de fichiers CSV / Excel et reconnaissance des exports comptables (Odoo ou autre)
import { ACC_SEC, CHART, fromBalance, keyForCode, r2 } from './pcmn';
import { readXlsx } from './xlsx-lite';

export type Raw = (string | number | null)[][];

/* ---------- lecture de fichiers ---------- */
function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const head = text.split(/\r?\n/).slice(0, 8).join('\n');
  const cnt = (ch: string) => (head.match(new RegExp(ch === '\t' ? '\\t' : '\\' + ch, 'g')) || []).length;
  const delim = [';', '\t', ',', '|'].map((d) => [d, cnt(d)] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((c) => c !== '')) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}
export async function readTable(file: File): Promise<Raw> {
  const buf = await file.arrayBuffer();
  if (/\.xlsx$/i.test(file.name) || (new Uint8Array(buf)[0] === 0x50 && new Uint8Array(buf)[1] === 0x4b)) {
    const sheets = await readXlsx(buf);
    const best = sheets.slice().sort((a, b) => b.rows.length - a.rows.length)[0];
    if (!best) throw new Error('Aucune feuille dans ce fichier Excel');
    return best.rows;
  }
  if (/\.xls$/i.test(file.name)) throw new Error('Format .xls non pris en charge : enregistrez le fichier en .xlsx ou en .csv');
  let txt: string;
  try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { txt = new TextDecoder('windows-1252').decode(buf); }
  return parseCsv(txt);
}

/* ---------- valeurs ---------- */
export function toNum(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v == null) return null;
  let s = String(v).trim().replace(/[€$\s  ]/g, '');
  if (!s || s === '-') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  if (/^[-−]/.test(s)) { neg = !neg; s = s.slice(1); }
  const lastC = s.lastIndexOf(','), lastD = s.lastIndexOf('.');
  if (lastC >= 0 && lastD >= 0) s = lastC > lastD ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lastC >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  const x = parseFloat(s); return isFinite(x) ? (neg ? -x : x) : null;
}
const MONTH_RE: [RegExp, number][] = [[/^janv?/, 1], [/^f[ée]vr?|^feb/, 2], [/^mar/, 3], [/^avr|^apr/, 4], [/^mai$|^may/, 5], [/^juin$|^jun/, 6], [/^juil|^jul/, 7], [/^ao[uû]|^aug/, 8], [/^sep/, 9], [/^oct/, 10], [/^nov/, 11], [/^d[ée]c|^dec/, 12]];
function monthFromName(s: string): number {
  const t = s.toLowerCase().normalize('NFC').trim();
  for (const [re, n] of MONTH_RE) if (re.test(t)) return n;
  return 0;
}
/** Date -> {y, m} (m de 1 à 12) ou null. Accepte jj/mm/aaaa, aaaa-mm-jj, mm/aaaa, aaaa-mm, « mars 2026 », numéro de série Excel */
export function toYM(v: unknown): { y: number; m: number } | null {
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; }
    return null;
  }
  const s = String(v ?? '').trim(); if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/.exec(s); if (m && +m[2] >= 1 && +m[2] <= 12) return { y: +m[1], m: +m[2] };
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s); if (m && +m[2] >= 1 && +m[2] <= 12) return { y: +m[3] < 100 ? 2000 + +m[3] : +m[3], m: +m[2] };
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(s); if (m && +m[1] >= 1 && +m[1] <= 12) return { y: +m[2], m: +m[1] };
  m = /^([A-Za-zéûÉ.]+)\s*[-/.]?\s*(\d{2,4})$/.exec(s); if (m && monthFromName(m[1])) return { y: +m[2] < 100 ? 2000 + +m[2] : +m[2], m: monthFromName(m[1]) };
  return null;
}

/* ---------- reconnaissance d'un export comptable ---------- */
export type Parsed = {
  layout: 'long' | 'wide' | 'annual';
  /** montants par année, par compte, 12 mois (plan comptable du budget, signe du budget) */
  byYear: Record<number, Record<string, number[]>>;
  /** layout « annual » : montant annuel par compte */
  annual: Record<string, number>;
  orientation: 'balance' | 'natural';
  unmatched: { code: string; amount: number }[];
  matched: number;
  rows: number;
  notes: string[];
  years: number[];
};
const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const ACCT = /^(n[o°]?\s*(de\s*)?)?(compte|account|code|n°)/;
const codeOf = (v: unknown): string => { if (typeof v === 'number') return Number.isInteger(v) ? String(v) : ''; const m = /^\s*(\d{3,8})(?!\d)/.exec(String(v ?? '')); return m ? m[1] : ''; };

export function parseLedger(raw: Raw, opts: { defaultYear: number; orientation?: 'auto' | 'balance' | 'natural' }): Parsed {
  const notes: string[] = [];
  // 1. ligne d'en-tête : celle qui contient une colonne « compte / code »
  let h = -1;
  for (let i = 0; i < Math.min(raw.length, 25); i++) { const r = raw[i] || []; if (r.filter((c) => c != null && String(c).trim() !== '').length >= 2 && r.some((c) => ACCT.test(norm(c)))) { h = i; break; } }
  if (h < 0) h = 0;
  const head = (raw[h] || []).map(norm);
  const body = raw.slice(h + 1).filter((r) => r && r.some((c) => c != null && String(c).trim() !== ''));
  // 2. colonne des comptes : l'en-tête, sinon la colonne qui contient le plus de codes numériques
  const width = Math.max(head.length, ...body.slice(0, 50).map((r) => r.length));
  let acct = head.findIndex((c) => ACCT.test(c));
  const score = (ci: number) => body.slice(0, 200).filter((r) => codeOf(r[ci])).length;
  if (acct < 0 || score(acct) === 0) { let best = -1, bs = 0; for (let i = 0; i < width; i++) { const s = score(i); if (s > bs) { bs = s; best = i; } } acct = best; }
  if (acct < 0) throw new Error('Aucune colonne de comptes (codes à 6 chiffres) reconnue dans ce fichier');
  const col = (re: RegExp) => head.findIndex((c) => re.test(c));
  const dateCol = col(/^(date|periode|mois|month|period)/);
  const deb = col(/^debit/), cre = col(/^credit/);
  let bal = col(/^(balance|solde|montant|amount|total|annee|year)/);
  // 3. colonnes mensuelles (« janv. », « 01/2026 », « M1 », 1…12)
  const monthCols: { ci: number; m: number; y?: number }[] = [];
  const rawHead = raw[h] || [];
  rawHead.forEach((c, ci) => {
    if (ci === acct || c == null) return;
    const s = String(c).trim(); let m = 0, y: number | undefined;
    if (typeof c === 'number' && Number.isInteger(c) && c >= 1 && c <= 12) m = c;
    else if (/^m\s?(\d{1,2})$/i.test(s)) m = +/(\d+)/.exec(s)![1];
    else { const ym = toYM(s); if (ym && /\d/.test(s) && s.length <= 12) { m = ym.m; y = ym.y; } else { const mm = /^([A-Za-zéûÉ.]+)(?:\s*(\d{2,4}))?$/.exec(s); if (mm && monthFromName(mm[1])) { m = monthFromName(mm[1]); if (mm[2]) y = +mm[2] < 100 ? 2000 + +mm[2] : +mm[2]; } } }
    if (m >= 1 && m <= 12) monthCols.push({ ci, m, y });
  });
  const byYear: Record<number, Record<string, number[]>> = {}; const annual: Record<string, number> = {};
  const rawSum: Record<string, number> = {};
  let layout: Parsed['layout'];
  const rec: { key: string; y: number; m: number; v: number }[] = []; const annRec: { key: string; v: number }[] = [];
  const unmatchedMap: Record<string, number> = {};
  const push = (code: string, y: number, m: number, v: number) => {
    const key = keyForCode(code);
    if (!key) { unmatchedMap[code] = (unmatchedMap[code] || 0) + v; return; }
    rec.push({ key, y, m, v });
  };
  let accounting = false;
  if (monthCols.length >= 6 && dateCol < 0) {
    layout = 'wide';
    for (const r of body) { const code = codeOf(r[acct]); if (!code) continue; for (const mc of monthCols) { const v = toNum(r[mc.ci]); if (v) push(code, mc.y || opts.defaultYear, mc.m, v); } }
    notes.push(`${monthCols.length} colonnes mensuelles reconnues`);
    accounting = head.some((c) => /debit|credit|balance|solde/.test(c));
  } else if (dateCol >= 0 && (deb >= 0 || cre >= 0 || bal >= 0)) {
    layout = 'long';
    const useDC = deb >= 0 || cre >= 0;
    if (!useDC) notes.push('Attention : une colonne « Balance » d’un grand livre Odoo est cumulée ; préférez un export avec Débit et Crédit.');
    for (const r of body) {
      const code = codeOf(r[acct]); if (!code) continue; const ym = toYM(r[dateCol]); if (!ym) continue;
      const v = useDC ? (toNum(r[deb]) || 0) - (toNum(r[cre]) || 0) : toNum(r[bal]); if (!v) continue;
      push(code, ym.y, ym.m, v);
    }
    accounting = true;
  } else if (deb >= 0 || cre >= 0 || bal >= 0) {
    layout = 'annual';
    const useDC = deb >= 0 || cre >= 0;
    for (const r of body) { const code = codeOf(r[acct]); if (!code) continue; const v = useDC ? (toNum(r[deb]) || 0) - (toNum(r[cre]) || 0) : toNum(r[bal]); if (!v) continue; const key = keyForCode(code); if (!key) { unmatchedMap[code] = (unmatchedMap[code] || 0) + v; continue; } annRec.push({ key, v }); }
    accounting = useDC || /balance|solde/.test(head[bal] || '');
    notes.push('Une seule période détectée : montants annuels');
  } else throw new Error('Format non reconnu : il faut soit 12 colonnes de mois, soit des colonnes Date + Débit/Crédit (ou Balance), soit une colonne de montants');
  // 4. orientation : soldes comptables (débit − crédit) ou montants déjà positifs
  const sumKind = (arr: { key: string; v: number }[], kind: string) => arr.filter((x) => ACC_SEC[x.key].kind === kind).reduce((a, x) => a + x.v, 0);
  const all: { key: string; v: number }[] = layout === 'annual' ? annRec : rec;
  let orientation: 'balance' | 'natural' = accounting ? 'balance' : 'natural';
  if (opts.orientation === 'balance' || opts.orientation === 'natural') orientation = opts.orientation;
  else if (!accounting) { const rev = sumKind(all, 'rev'), cost = sumKind(all, 'cost'); if (rev < 0 && cost >= 0) orientation = 'balance'; }
  const conv = (key: string, v: number) => (orientation === 'balance' ? fromBalance(key, v) : v);
  if (layout === 'annual') annRec.forEach((x) => { annual[x.key] = r2((annual[x.key] || 0) + conv(x.key, x.v)); });
  else rec.forEach((x) => { const a = ((byYear[x.y] = byYear[x.y] || {})[x.key] = byYear[x.y][x.key] || Array(12).fill(0)); a[x.m - 1] = r2(a[x.m - 1] + conv(x.key, x.v)); });
  const matchedKeys = new Set(all.map((x) => x.key));
  void rawSum; void CHART;
  return {
    layout, byYear, annual, orientation, matched: matchedKeys.size, rows: body.length, notes,
    unmatched: Object.entries(unmatchedMap).map(([code, amount]) => ({ code, amount })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
    years: Object.keys(byYear).map(Number).sort((a, b) => a - b),
  };
}
