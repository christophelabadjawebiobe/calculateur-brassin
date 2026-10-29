'use client';
/* =====================================================================
   app/apps/budget/page.tsx : Budget prévisionnel (PCMN) de la Brasserie coopérative La Badjawe
   - structure comptable de « creation budjet.xlsx » ; année budgétaire au choix (mois + trimestres facultatifs + total)
   - années de référence (réalisé) dépliables une à une ; import d'une année (Odoo / Excel / CSV) et reprise comme base du budget
   - commentaire sur chaque compte et chaque sous-ligne ; export Excel (.xlsx) et CSV ; validation du budget par un administrateur
   Données : pcmn_budget_plans (budget), pcmn_budget_history (réalisé annuel), pcmn_actuals (réalisé mensuel) : sql/02 et sql/04
   ===================================================================== */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import LedgerImport, { LI_CSS } from '@/components/LedgerImport';
import { createClient } from '@/lib/supabase/client';
import {
  CHART, MONTHS, RES_AFTER, RES_HINT, RES_LABEL, Z12, accMonths, addTo, applyPct, cloneEntry, colVal, colsFor, emptyEntry, eur0, fmt0, leafMonths, parseNum, pctTxt, quarter, r2,
  results, secAccKeys, sum, uid, type Acc, type Col, type Entry, type Hist, type Leaf, type Mode, type Plan, type Sec,
} from '@/lib/pcmn';
import { writeXlsx, type Cell } from '@/lib/xlsx-lite';

const DEFAULT_YEAR = 2026;
const T_PLAN = 'pcmn_budget_plans', T_HIST = 'pcmn_budget_history', T_ACT = 'pcmn_actuals';
const PREFS = 'badjawe-budget-prefs';

async function fetchAll(q: (from: number, to: number) => any): Promise<{ data: any[]; error: any }> {
  const out: any[] = [];
  for (let i = 0; i < 100; i++) {
    const r = await q(i * 1000, i * 1000 + 999);
    if (r.error) return { data: out, error: r.error };
    out.push(...(r.data || []));
    if (!r.data || r.data.length < 1000) break;
  }
  return { data: out, error: null };
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

const HistCells = memo(function HistCells({ vals }: { vals: (number | undefined)[] }) {
  return <>{vals.map((v, i) => <td key={i} className="n hist">{v === undefined ? '' : fmt0(v)}</td>)}</>;
});

function TotalCells({ months, refv }: { months: number[]; refv: number | undefined }) {
  const t = sum(months);
  return (<><td className="n tot">{fmt0(t)}</td><td className="n delta">{refv === undefined ? '' : pctTxt(t, refv)}</td></>);
}

function MonthCells({ months, cols }: { months: number[]; cols: Col[] }) {
  return <>{cols.map((c, i) => <td key={i} className={'n ' + (c.t === 'q' ? 'q' : '')}>{fmt0(colVal(months, c))}</td>)}</>;
}

function LeafCells({ leaf, ro, edit, label, cols }: { leaf: Leaf; ro: boolean; edit: (fn: (l: Leaf) => void) => void; label: string; cols: Col[] }) {
  const m = leafMonths(leaf);
  return (
    <>
      {cols.map((c, i) => c.t === 'q'
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

const CommentCell = ({ value, ro, label, onChange }: { value: string | undefined; ro: boolean; label: string; onChange: (v: string) => void }) => (
  <td className="cm"><input className="bd-cmi" type="text" maxLength={600} disabled={ro && !value} readOnly={ro} aria-label={`Commentaire : ${label}`} title={value || ''} placeholder={ro ? '' : 'Commentaire…'} value={value || ''} onChange={(e) => onChange(e.target.value)} /></td>
);

const ModeBtn = ({ mode, onClick, ro }: { mode: Mode; onClick: () => void; ro: boolean }) => (
  <button type="button" className={'bd-mode ' + mode} disabled={ro} onClick={onClick}
    title={mode === 'annual' ? 'Montant annuel réparti sur 12 mois : cliquez pour saisir mois par mois' : 'Saisie mois par mois : cliquez pour saisir un montant annuel'}>{mode === 'annual' ? 'An' : '12 m'}</button>
);

type AccProps = {
  sec: Sec; acc: Acc; entry: Entry | undefined; hist: Record<number, number> | undefined; years: number[]; refYear: number | null;
  open: boolean; ro: boolean; cols: Col[]; showC: boolean; onEdit: EditFn; onToggle: (k: string) => void;
};

const AccountRows = memo(function AccountRows({ sec, acc, entry, hist, years, refYear, open, ro, cols, showC, onEdit, onToggle }: AccProps) {
  const [k, code, label] = acc;
  const e = entry || emptyEntry();
  const subs = e.subs || [];
  const months = accMonths(e);
  const hasSubs = subs.length > 0;
  const h = years.map((y) => (hist ? hist[y] : undefined));
  const ref = refYear != null && hist ? hist[refYear] : undefined;
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
        if (basis === 'hist' && !en.subs.length) { const b = (refYear != null && hist ? hist[refYear] || 0 : 0) / 12; L.mode = 'monthly'; L.months = Z12().map(() => r2(b * f)); }
        else if (basis === 'chain') { const m0 = leafMonths(L)[0]; L.mode = 'monthly'; L.months = Z12().map((_, i) => r2(m0 * Math.pow(f, i))); }
        else if (L.mode === 'annual') L.annual = r2(L.annual * f); else L.months = L.months.map((x) => r2(x * f));
      }
    });
    setPct('');
  };
  const span = 2 + years.length + cols.length + 2 + (showC ? 1 : 0);
  return (
    <>
      <tr className={'acc' + (open ? ' is-open' : '')}>
        <th className="lbl" scope="row">
          <button type="button" className="bd-tw" aria-expanded={open} aria-label={`Détail du compte ${code} ${label}`} onClick={() => onToggle(k)}>{open ? '▾' : '▸'}</button>
          <span className="code">{code.startsWith('x') ? '' : code}</span><span className="nm" title={label}>{label}</span>
          {hasSubs ? <span className="bd-badge" title="Total = somme des lignes de détail">{subs.length} détail{subs.length > 1 ? 's' : ''}</span> : null}
        </th>
        <td className="tools">{hasSubs ? null : <ModeBtn mode={e.mode} ro={ro} onClick={() => onEdit(k, (en) => toggleLeafMode(en))} />}</td>
        <HistCells vals={h} />
        {hasSubs ? <><MonthCells months={months} cols={cols} /><TotalCells months={months} refv={ref} /></> : <><LeafCells leaf={e} ro={ro} cols={cols} label={`${code} ${label}`} edit={(fn) => onEdit(k, (en) => fn(en))} /><td className="n delta">{ref === undefined ? '' : pctTxt(sum(months), ref)}</td></>}
        {showC ? <CommentCell value={e.comment} ro={ro} label={`${code} ${label}`} onChange={(v) => onEdit(k, (en) => { en.comment = v; })} /> : null}
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
                <option value="hist" disabled={refYear == null}>sur le réalisé {refYear ?? ''} ÷ 12</option>
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
            {!showC ? (
              <div className="bd-pg"><span className="bd-pt">Commentaire</span>
                <input className="bd-in wide" style={{ width: 'min(100%,520px)' }} type="text" maxLength={600} readOnly={ro} aria-label={`Commentaire : ${code} ${label}`} placeholder="Pourquoi ce montant ?" value={e.comment || ''} onChange={(ev) => onEdit(k, (en) => { en.comment = ev.target.value; })} />
              </div>) : null}
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
          <HistCells vals={years.map(() => undefined)} />
          <LeafCells leaf={s} ro={ro} cols={cols} label={`${label} : ${s.label}`} edit={(fn) => onEdit(k, (en) => fn(en.subs[i]))} />
          <td className="n delta"></td>
          {showC ? <CommentCell value={s.comment} ro={ro} label={`${label} : ${s.label}`} onChange={(v) => onEdit(k, (en) => { en.subs[i].comment = v; })} /> : null}
        </tr>
      ))}
    </>
  );
});

/* ====================================================================
   Page
   ==================================================================== */
type Validation = { at: string | null; data: Plan | null };
const download = (data: BlobPart, name: string, type: string) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
const readPrefs = (): { showQ?: boolean; showC?: boolean; shownY?: Record<number, boolean> } => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch { return {}; } };
const writePrefs = (p: object) => { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* navigation privée : sans importance */ } };

export default function BudgetPage() {
  const router = useRouter();
  const routerRef = useRef(router); routerRef.current = router;
  const supabase = useMemo(() => createClient(), []);
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [planYears, setPlanYears] = useState<number[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [hist, setHist] = useState<Hist>({});
  const [canWrite, setCanWrite] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [valid, setValid] = useState<Validation>({ at: null, data: null });
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState({ txt: 'Chargement…', off: false });
  const [showQ, setShowQ] = useState(true);
  const [showC, setShowC] = useState(true);
  const [shownY, setShownY] = useState<Record<number, boolean>>({});
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({});
  const [openGrp, setOpenGrp] = useState<Record<string, boolean>>({});
  const [openAcc, setOpenAcc] = useState<Record<string, boolean>>({});
  const [gPct, setGPct] = useState(''), [gBasis, setGBasis] = useState<'current' | 'hist' | 'chain'>('current'), [gScope, setGScope] = useState('all');
  const [conflict, setConflict] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const R = useRef<{ stamp: string | null; timer: any; dirty: boolean; saving: boolean; plan: Plan | null; undo: Plan[]; year: number }>({ stamp: null, timer: null, dirty: false, saving: false, plan: null, undo: [], year: DEFAULT_YEAR });
  const [undoN, setUndoN] = useState(0);
  const ro = !canWrite;

  /* ---- préférences d'affichage (mémorisées dans le navigateur) ---- */
  useEffect(() => { const p = readPrefs(); if (typeof p.showQ === 'boolean') setShowQ(p.showQ); if (typeof p.showC === 'boolean') setShowC(p.showC); if (p.shownY) setShownY(p.shownY); }, []);
  const setPref = (patch: { showQ?: boolean; showC?: boolean; shownY?: Record<number, boolean> }) => writePrefs({ showQ, showC, shownY, ...patch });

  /* ---- chargement : accès, droits, historique, plan de l'année ---- */
  const loadHist = useCallback(async () => {
    const h = await fetchAll((a, b) => supabase.from(T_HIST).select('account_key,year,amount').range(a, b));
    if (h.error) return h.error;
    const H: Hist = {};
    h.data.forEach((r: any) => { (H[r.account_key] = H[r.account_key] || {})[r.year] = Number(r.amount); });
    setHist(H);
    return null;
  }, [supabase]);

  const load = useCallback(async (y: number) => {
    setStatus({ txt: 'Chargement…', off: false });
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth || !auth.user) { routerRef.current.replace('/login?next=/apps/budget'); return; }
      const acc = await supabase.rpc('has_app_access', { p_route: '/apps/budget' });
      if (!acc.error && acc.data === false) { routerRef.current.replace('/dashboard'); return; }
      const [w, adm] = await Promise.all([supabase.rpc('can_write_budget'), supabase.rpc('is_admin')]);
      setCanWrite(Boolean(w.data)); setIsAdmin(Boolean(adm.data));
      const herr = await loadHist();
      const py = await supabase.from(T_PLAN).select('year').order('year');
      const p = await supabase.from(T_PLAN).select('data,updated_at,validated_at,validated_data').eq('year', y).maybeSingle();
      const err = herr || py.error || p.error;
      if (err) {
        const m = err.message || '';
        setNotice(/relation|does not exist|schema cache/i.test(m) ? 'Les tables du budget n’existent pas encore : exécutez sql/02_budget_pcmn.sql puis sql/04_admin_reel_validation.sql dans Supabase (SQL Editor), puis rechargez la page.' : /validated/i.test(m) ? 'Colonnes de validation absentes : exécutez sql/04_admin_reel_validation.sql dans Supabase, puis rechargez la page.' : 'Chargement impossible : ' + m);
      } else setNotice('');
      setPlanYears(((py.data || []) as any[]).map((r) => r.year));
      const raw = p.data && p.data.data && p.data.data.rows ? p.data.data : { v: 1, rows: {} };
      const rows: Record<string, Entry> = {};
      Object.keys(raw.rows).forEach((k) => { rows[k] = cloneEntry(raw.rows[k]); });
      const pl: Plan = { v: 1, rows };
      R.current.plan = pl; R.current.year = y; R.current.stamp = p.data ? p.data.updated_at : null; R.current.dirty = false; R.current.undo = []; setUndoN(0); setConflict(false);
      setValid({ at: p.data ? p.data.validated_at || null : null, data: p.data && p.data.validated_data ? p.data.validated_data : null });
      setPlan(pl); setYear(y);
      setStatus({ txt: w.data ? (p.data ? 'Budget chargé' : 'Nouveau budget : enregistré à la première modification') : 'Lecture seule', off: !w.data });
    } catch (e: any) {
      setNotice('Chargement impossible : ' + (e && e.message ? e.message : 'erreur réseau'));
      setStatus({ txt: 'Hors ligne', off: true });
    }
    setReady(true);
  }, [supabase, loadHist]);
  useEffect(() => { load(DEFAULT_YEAR); }, [load]);

  /* ---- enregistrement différé ---- */
  const save = useCallback(async () => {
    const r = R.current;
    if (!r.plan || !r.dirty || r.saving) return;
    r.saving = true; setStatus({ txt: 'Enregistrement…', off: false });
    const snapshot = r.plan, y = r.year;
    try {
      let res: any;
      if (r.stamp) res = await supabase.from(T_PLAN).update({ data: snapshot }).eq('year', y).eq('updated_at', r.stamp).select('updated_at');
      else res = await supabase.from(T_PLAN).insert({ year: y, data: snapshot }).select('updated_at');
      if (res.error) {
        if (res.error.code === '23505') { setConflict(true); setStatus({ txt: 'Conflit : budget modifié ailleurs', off: true }); }
        else throw res.error;
      } else if (!res.data || !res.data.length) { setConflict(true); setStatus({ txt: 'Conflit : budget modifié ailleurs', off: true }); }
      else {
        r.stamp = res.data[0].updated_at; r.dirty = r.plan !== snapshot;
        setPlanYears((a) => (a.includes(y) ? a : [...a, y].sort()));
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
  /** enregistre tout de suite (avant de changer d'année, de valider…) ; renvoie false si des modifications restent non enregistrées */
  const flush = async () => {
    const r = R.current; clearTimeout(r.timer);
    for (let i = 0; i < 4 && r.dirty && !r.saving; i++) await save();
    return !r.dirty;
  };

  const onEdit: EditFn = useCallback((key, fn) => {
    const r = R.current; if (!r.plan || ro) return;
    const e = cloneEntry(r.plan.rows[key]); fn(e);
    commit({ ...r.plan, rows: { ...r.plan.rows, [key]: e } });
  }, [commit, ro]);
  const toggleAcc = useCallback((k: string) => setOpenAcc((o) => ({ ...o, [k]: !o[k] }), ), []);

  /* ---- années de référence ---- */
  const years = useMemo(() => { const s = new Set<number>(); Object.values(hist).forEach((o) => Object.keys(o).forEach((y) => s.add(+y))); return [...s].sort((a, b) => a - b); }, [hist]);
  const shown = useMemo(() => years.filter((y) => shownY[y]), [years, shownY]);
  const refYear = useMemo(() => { const c = years.filter((y) => y < year); return c.length ? c[c.length - 1] : null; }, [years, year]);
  const cols = useMemo(() => colsFor(showQ), [showQ]);
  const toggleYear = (y: number) => { const n = { ...shownY, [y]: !shownY[y] }; setShownY(n); setPref({ shownY: n }); };
  const setAllYears = (on: boolean) => { const n: Record<number, boolean> = {}; years.forEach((y) => { n[y] = on; }); setShownY(n); setPref({ shownY: n }); };

  /* ---- calculs ---- */
  const calc = useMemo(() => {
    const rows = plan ? plan.rows : {};
    const accM: Record<string, number[]> = {}, secM: Record<string, number[]> = {}, grpM: Record<string, number[]> = {};
    const secH: Record<string, number[]> = {}, grpH: Record<string, number[]> = {};
    const ny = years.length;
    CHART.forEach((s) => {
      secM[s.k] = Z12(); secH[s.k] = Array(ny).fill(0);
      s.groups.forEach((g, gi) => {
        const gk = s.k + ':' + gi; grpM[gk] = Z12(); grpH[gk] = Array(ny).fill(0);
        g.accounts.forEach((a) => {
          const m = accMonths(rows[a[0]]); accM[a[0]] = m; addTo(grpM[gk], m);
          years.forEach((y, i) => { grpH[gk][i] += (hist[a[0]] || {})[y] || 0; });
        });
        addTo(secM[s.k], grpM[gk]); addTo(secH[s.k], grpH[gk]);
      });
    });
    return { accM, secM, grpM, secH, grpH, resM: results(secM, 12), resH: results(secH, ny) };
  }, [plan, hist, years]);
  const ix = (arr: number[], y: number) => arr[years.indexOf(y)];
  const pick = (arr: number[]) => shown.map((y) => ix(arr, y));
  const refOf = (arr: number[]) => (refYear == null ? undefined : ix(arr, refYear));

  const kpi = (key: string) => {
    const t = key === 'ca' ? sum(calc.secM.s70) : sum(calc.resM[key]);
    const h = refYear == null ? undefined : key === 'ca' ? ix(calc.secH.s70, refYear) : ix(calc.resH[key], refYear);
    return { t, h };
  };

  /* ---- actions globales ---- */
  const applyGlobalPct = () => {
    const p = parseNum(gPct); const r = R.current; if (!p || !r.plan || ro) return;
    const keys = gScope === 'all' ? CHART.flatMap(secAccKeys) : secAccKeys(CHART.find((s) => s.k === gScope)!);
    commit(applyPct(r.plan, keys, p, gBasis, hist, refYear ?? 0), r.plan); setGPct('');
  };
  const undo = () => { const r = R.current; const prev = r.undo.pop(); setUndoN(r.undo.length); if (prev) commit(prev); };
  const setAll = (open: boolean) => { const o: Record<string, boolean> = {}; CHART.forEach((s) => { o[s.k] = open; s.groups.forEach((_, gi) => { o[s.k + ':' + gi] = open; }); }); setOpenSec(o); setOpenGrp(o); if (!open) setOpenAcc({}); };
  const changeYear = async (y: number) => {
    if (y === year) return;
    if (!(await flush()) && !confirm('Des modifications ne sont pas enregistrées. Changer d’année quand même ?')) return;
    setReady(false); await load(y);
  };

  /* ---- export : toutes les années de référence, les mois, les trimestres selon l'interrupteur, les commentaires ---- */
  type Line = { kind: 'sec' | 'grp' | 'acc' | 'sub' | 'res'; code: string; label: string; h: (number | undefined)[]; m: number[]; comment?: string };
  const buildLines = (): Line[] => {
    const out: Line[] = [];
    const H = (arr: number[]) => years.map((_, i) => arr[i]);
    CHART.forEach((s) => {
      out.push({ kind: 'sec', code: s.code, label: s.label, h: H(calc.secH[s.k]), m: calc.secM[s.k] });
      s.groups.forEach((g, gi) => {
        if (s.groups.length > 1) out.push({ kind: 'grp', code: '', label: g.label || '', h: H(calc.grpH[s.k + ':' + gi]), m: calc.grpM[s.k + ':' + gi] });
        g.accounts.forEach((a) => {
          const e = plan && plan.rows[a[0]];
          out.push({ kind: 'acc', code: a[1].startsWith('x') ? '' : a[1], label: a[2], h: years.map((y) => (hist[a[0]] || {})[y]), m: calc.accM[a[0]], comment: (e && e.comment) || undefined });
          if (e) e.subs.forEach((sb) => out.push({ kind: 'sub', code: '', label: sb.label, h: years.map(() => undefined), m: leafMonths(sb), comment: sb.comment }));
        });
      });
      (RES_AFTER[s.k] || []).forEach((rk) => out.push({ kind: 'res', code: '', label: RES_LABEL[rk], h: H(calc.resH[rk]), m: calc.resM[rk] }));
    });
    return out;
  };
  const headRow = (): string[] => ['Code', 'Libellé', ...years.map((y) => `Réalisé ${y}`), ...cols.map((c) => (c.t === 'm' ? MONTHS[c.i] : 'T' + (c.i + 1))), `Total ${year}`, refYear != null ? `vs ${refYear} (%)` : '', 'Commentaire'];
  const exportCsv = () => {
    const q = (v: any) => { if (typeof v === 'number') return isFinite(v) ? String(r2(v)).replace('.', ',') : ''; const t = String(v == null ? '' : v); return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const out: any[][] = [headRow()];
    buildLines().forEach((l) => {
      const ref = refYear == null ? undefined : l.h[years.indexOf(refYear)];
      out.push([l.code, (l.kind === 'acc' ? '   ' : l.kind === 'sub' ? '      ' : '') + l.label, ...l.h.map((x) => (x === undefined ? '' : x)), ...cols.map((c) => colVal(l.m, c)), sum(l.m), ref !== undefined && Math.abs(ref) >= 0.5 ? r2(((sum(l.m) - ref) / Math.abs(ref)) * 100) : '', l.comment || '']);
    });
    download('﻿' + out.map((r) => r.map(q).join(';')).join('\r\n'), `budget-${year}.csv`, 'text/csv;charset=utf-8');
  };
  const exportXlsx = () => {
    const lines = buildLines();
    const rows: Cell[][] = [headRow().map((t) => ({ v: t, s: 'h' as const }))];
    lines.forEach((l) => {
      const strong = l.kind === 'sec' || l.kind === 'res', band = l.kind === 'sec';
      const ns = band ? 'qn' : strong ? 'bn' : 'n';
      const ref = refYear == null ? undefined : l.h[years.indexOf(refYear)];
      const pct = ref !== undefined && Math.abs(ref) >= 0.5 ? r2(((sum(l.m) - ref) / Math.abs(ref)) * 100) : null;
      rows.push([
        { v: l.code, s: band ? 'q' : undefined }, { v: (l.kind === 'acc' ? '   ' : l.kind === 'sub' ? '      ' : '') + l.label, s: band ? 'q' : strong || l.kind === 'grp' ? 'b' : undefined },
        ...l.h.map((x) => ({ v: x === undefined ? null : r2(x), s: ns as any })),
        ...cols.map((c) => ({ v: r2(colVal(l.m, c)), s: (c.t === 'q' && !band ? (strong ? 'bn' : 'bn') : ns) as any })),
        { v: r2(sum(l.m)), s: (band ? 'qn' : 'bn') as any }, { v: pct, s: ns as any }, { v: l.comment || null, s: 'w' as const },
      ]);
    });
    const widths = [10, 52, ...years.map(() => 13), ...cols.map((c) => (c.t === 'q' ? 12 : 10)), 13, 11, 60];
    const comments: Cell[][] = [[{ v: 'Code', s: 'h' }, { v: 'Compte / ligne', s: 'h' }, { v: 'Commentaire', s: 'h' }]];
    lines.filter((l) => l.comment && (l.kind === 'acc' || l.kind === 'sub')).forEach((l) => comments.push([l.code, l.label, { v: l.comment || null, s: 'w' }]));
    const info: Cell[][] = [
      [{ v: 'Budget prévisionnel', s: 'b' }, `La Badjawe · année ${year}`],
      ['Exporté le', new Date().toLocaleString('fr-BE')],
      ['Statut', valid.at ? 'Validé le ' + new Date(valid.at).toLocaleDateString('fr-BE') : 'Brouillon (non validé)'],
      ['Montants', '€ HTVA ; charges et produits en positif ; résultats = formules du fichier « creation budjet.xlsx »'],
    ];
    const bytes = writeXlsx([
      { name: 'Budget ' + year, rows, widths, freeze: { cols: 2, rows: 1 } },
      { name: 'Commentaires', rows: comments, widths: [10, 50, 90] },
      { name: 'Informations', rows: info, widths: [20, 90] },
    ]);
    download(bytes as any, `budget-${year}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  /* ---- validation du budget (administrateur) ---- */
  const validate = async (on: boolean) => {
    if (!(await flush())) { setNotice('Enregistrez d’abord les modifications en cours (conflit ou erreur d’enregistrement).'); return; }
    if (!confirm(on ? `Valider le budget ${year} ? Une copie figée servira de référence à l’analyse du réalisé.` : `Retirer la validation du budget ${year} ?`)) return;
    const r = await supabase.rpc('validate_pcmn_budget', { p_year: year, p_validate: on });
    if (r.error) { setNotice('Validation impossible : ' + r.error.message); return; }
    setValid({ at: on ? (r.data as string) || new Date().toISOString() : null, data: on ? R.current.plan : null });
    setStatus({ txt: on ? 'Budget validé' : 'Validation retirée', off: false });
  };

  /* ---- base du budget : reprise d'une année de référence ---- */
  const [bRef, setBRef] = useState<number | ''>(''), [bPct, setBPct] = useState(''), [bScope, setBScope] = useState('all'), [bMode, setBMode] = useState<'empty' | 'all'>('empty'), [bMsg, setBMsg] = useState('');
  const useAsBase = async () => {
    const r = R.current; const y = bRef === '' ? refYear : bRef;
    if (!r.plan || ro || y == null) return;
    const keys = bScope === 'all' ? CHART.flatMap(secAccKeys) : secAccKeys(CHART.find((s) => s.k === bScope)!);
    const a = await fetchAll((f, t) => supabase.from(T_ACT).select('account_key,month,amount').eq('year', y).range(f, t));
    if (a.error) { setBMsg('Lecture du réalisé mensuel impossible : ' + a.error.message); return; }
    const monthly: Record<string, number[]> = {};
    a.data.forEach((x: any) => { (monthly[x.account_key] = monthly[x.account_key] || Z12())[x.month - 1] = Number(x.amount); });
    const f = 1 + (parseNum(bPct) || 0) / 100;
    if (bMode === 'all' && !confirm(`Remplacer les montants existants (y compris les lignes de détail) par ceux de ${y} ?`)) return;
    const rows = { ...r.plan.rows }; let n = 0, nm = 0;
    for (const k of keys) {
      const cur = rows[k]; const hasVal = cur && (cur.subs.length > 0 || Math.abs(sum(accMonths(cur))) >= 0.005);
      if (bMode === 'empty' && hasVal) continue;
      const e = cloneEntry(cur);
      if (monthly[k] && monthly[k].some((v) => Math.abs(v) >= 0.005)) { e.subs = []; e.mode = 'monthly'; e.months = monthly[k].map((v) => r2(v * f)); e.annual = 0; nm++; }
      else if (hist[k] && hist[k][y] !== undefined && Math.abs(hist[k][y]) >= 0.005) { e.subs = []; e.mode = 'annual'; e.annual = r2(hist[k][y] * f); e.months = Z12(); }
      else continue;
      rows[k] = e; n++;
    }
    commit({ ...r.plan, rows }, r.plan);
    setBMsg(n ? `${n} comptes repris de ${y}${nm ? ` (${nm} avec saisonnalité mensuelle)` : ' (montants annuels répartis sur 12 mois)'}${parseNum(bPct) ? ` ${parseNum(bPct) > 0 ? '+' : '−'} ${Math.abs(parseNum(bPct))} %` : ''}. Vous pouvez annuler avec « ↶ Annuler ».` : `Aucun compte à reprendre pour ${y} (${bMode === 'empty' ? 'lignes déjà remplies ?' : 'pas de données'}).`);
  };

  /* ---- rendu ---- */
  const span = 2 + shown.length + cols.length + 2 + (showC ? 1 : 0);
  const ResRow = ({ rk }: { rk: string }) => {
    const m = calc.resM[rk], h = pick(calc.resH[rk]);
    return (
      <tr className={'res res-' + rk}>
        <th className="lbl" scope="row" title={RES_HINT[rk]}><span className="nm">{RES_LABEL[rk]}</span></th>
        <td className="tools"></td>
        {h.map((v, i) => <td key={i} className={'n hist' + (v < 0 ? ' neg' : '')}>{fmt0(v)}</td>)}
        {cols.map((c, i) => { const v = colVal(m, c); return <td key={i} className={'n ' + (c.t === 'q' ? 'q ' : '') + (v < -0.5 ? 'neg' : '')}>{fmt0(v)}</td>; })}
        <td className={'n tot' + (sum(m) < -0.5 ? ' neg' : '')}>{fmt0(sum(m))}</td><td className="n delta">{refOf(calc.resH[rk]) === undefined ? '' : pctTxt(sum(m), refOf(calc.resH[rk])!)}</td>
        {showC ? <td className="cm" /> : null}
      </tr>
    );
  };
  const kpis: [string, string, string][] = [['ca', "Chiffre d'affaires", 'Classe 70'], ['mb', 'Marge brute', RES_HINT.mb], ['ebitda', 'EBITDA', RES_HINT.ebitda], ['re', "Résultat d'exploitation", RES_HINT.re], ['net', 'Résultat net', RES_HINT.net]];
  const yearOptions = useMemo(() => [...new Set([...planYears, ...years.map((y) => y + 1), year, DEFAULT_YEAR, DEFAULT_YEAR + 1])].filter((y) => y >= 2000 && y <= 2100).sort((a, b) => a - b), [planYears, years, year]);

  const right = (
    <>
      <span className={'site-state' + (status.off ? ' off' : '')} role="status"><span className="dot" /><span>{status.txt}</span></span>
      <span className={'site-role' + (valid.at ? '' : ' ro')} title={valid.at ? 'Budget validé le ' + new Date(valid.at).toLocaleDateString('fr-BE') : 'Budget non validé (brouillon)'}>{valid.at ? 'Validé' : 'Brouillon'} {year}</span>
    </>
  );

  return (
    <>
      <AppHeader title="Budget prévisionnel" right={right} />
      <style dangerouslySetInnerHTML={{ __html: BD_CSS + LI_CSS }} />
      <div className="bd-root">
        <main className="bd-wrap">
          {notice ? <div className="bd-alert" role="alert">{notice}</div> : null}
          {conflict ? <div className="bd-alert" role="alert">Ce budget a été modifié par quelqu’un d’autre depuis votre ouverture. <button type="button" className="bd-btn sm" onClick={() => load(year)}>Recharger la version enregistrée</button> (vos modifications non enregistrées seront perdues).</div> : null}
          {!ready ? <p className="bd-loading">Chargement du budget…</p> : (
            <>
              <section className="bd-kpis" aria-label="Indicateurs du budget">
                {kpis.map(([k, label, hint]) => { const { t, h } = kpi(k); return (
                  <div className="bd-kpi" key={k} title={hint}>
                    <div className="l">{label}</div>
                    <div className={'v' + (t < -0.5 ? ' neg' : '')}>{eur0(t)}</div>
                    <div className="s">{refYear == null || h === undefined ? 'Pas d’année de référence' : `${refYear} : ${eur0(h)} · ${pctTxt(t, h)}`}</div>
                  </div>); })}
              </section>

              <section className="bd-bar" aria-label="Affichage">
                <label className="bd-lbl" htmlFor="bd-year">Année du budget</label>
                <select id="bd-year" value={year} onChange={(e) => changeYear(+e.target.value)}>{yearOptions.map((y) => <option key={y} value={y}>{y}{planYears.includes(y) ? '' : ' (nouveau)'}</option>)}</select>
                <span className="bd-sep" />
                <span className="bd-lbl" id="bd-yrs">Années de référence</span>
                <span className="bd-chips" role="group" aria-labelledby="bd-yrs">
                  {years.map((y) => <button key={y} type="button" className="bd-btn sm" aria-pressed={!!shownY[y]} onClick={() => toggleYear(y)} title={`${shownY[y] ? 'Replier' : 'Déplier'} le réalisé ${y}`}>{shownY[y] ? '▾' : '▸'} {y}</button>)}
                  {years.length > 1 ? <button type="button" className="bd-btn sm" onClick={() => setAllYears(shown.length !== years.length)}>{shown.length === years.length ? 'Aucune' : 'Toutes'}</button> : null}
                  {!years.length ? <span className="bd-hint">aucune (importez une année)</span> : null}
                </span>
                <span className="bd-sep" />
                <label className="bd-switch"><input type="checkbox" role="switch" checked={showQ} onChange={(e) => { setShowQ(e.target.checked); setPref({ showQ: e.target.checked }); }} /><span>Trimestres T1–T4</span></label>
                <label className="bd-switch"><input type="checkbox" role="switch" checked={showC} onChange={(e) => { setShowC(e.target.checked); setPref({ showC: e.target.checked }); }} /><span>Commentaires</span></label>
                <span className="bd-sep" />
                <button type="button" className="bd-btn" onClick={() => setAll(true)}>Tout déplier</button>
                <button type="button" className="bd-btn" onClick={() => setAll(false)}>Tout replier</button>
              </section>

              <section className="bd-bar" aria-label="Outils du budget">
                <label className="bd-lbl" htmlFor="g-pct">Variation en %</label>
                <input id="g-pct" className="bd-in w70" type="text" inputMode="decimal" disabled={ro} placeholder="+5 ou −3" value={gPct} onChange={(e) => setGPct(e.target.value)} />
                <select disabled={ro} aria-label="Lignes concernées" value={gScope} onChange={(e) => setGScope(e.target.value)}>
                  <option value="all">Tout le budget</option>
                  {CHART.map((s) => <option key={s.k} value={s.k}>{(s.code ? s.code + ' · ' : '') + s.label}</option>)}
                </select>
                <select disabled={ro} aria-label="Base de la variation" value={gBasis} onChange={(e) => setGBasis(e.target.value as any)}>
                  <option value="current">sur les montants actuels</option>
                  <option value="hist" disabled={refYear == null}>sur le réalisé {refYear ?? ''} ÷ 12</option>
                  <option value="chain">de mois en mois (cumulée)</option>
                </select>
                <button type="button" className="bd-btn primary" disabled={ro || !parseNum(gPct)} onClick={applyGlobalPct}>Appliquer</button>
                <button type="button" className="bd-btn" disabled={ro || !undoN} onClick={undo} title="Annule la dernière variation ou reprise d’année">↶ Annuler</button>
                <span className="bd-sep" />
                <button type="button" className="bd-btn" aria-expanded={importOpen} onClick={() => setImportOpen((v) => !v)}>⭳ Importer une année</button>
                <button type="button" className="bd-btn" onClick={exportXlsx}>Exporter en Excel</button>
                <button type="button" className="bd-btn" onClick={exportCsv}>Exporter en CSV</button>
                {isAdmin ? (valid.at
                  ? <button type="button" className="bd-btn" onClick={() => validate(false)}>Retirer la validation</button>
                  : <button type="button" className="bd-btn primary" disabled={!plan || !planYears.includes(year) && !R.current.stamp} onClick={() => validate(true)}>✓ Valider ce budget</button>) : null}
              </section>
              {valid.at ? <p className="bd-hint">Budget validé le {new Date(valid.at).toLocaleDateString('fr-BE')} : une copie figée sert de référence à l’analyse du réalisé. Vos modifications ultérieures ne changent que le brouillon ; revalidez pour mettre à jour la référence.</p> : null}

              {importOpen ? (
                <section className="bd-modal" aria-label="Importer une année">
                  <div className="bd-modal-h"><b>Importer une année</b><button type="button" className="bd-x" aria-label="Fermer" onClick={() => setImportOpen(false)}>×</button></div>
                  <h3>1. Charger les chiffres d’une année</h3>
                  <LedgerImport defaultYear={year - 1} canWrite={canWrite} onImported={async (ys) => { await loadHist(); const n = { ...shownY }; ys.forEach((y) => { n[y] = true; }); setShownY(n); setPref({ shownY: n }); }} />
                  <h3>2. Prendre une année comme base du budget {year}</h3>
                  <div className="li-box">
                    <div className="li-row">
                      <label htmlFor="b-ref">Année de référence</label>
                      <select id="b-ref" value={bRef === '' ? (refYear ?? '') : bRef} onChange={(e) => setBRef(e.target.value ? +e.target.value : '')} disabled={!years.length}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
                      <label htmlFor="b-pct">Variation</label>
                      <input id="b-pct" className="bd-in w70" type="text" inputMode="decimal" placeholder="+3" value={bPct} onChange={(e) => setBPct(e.target.value)} /><span className="bd-u">%</span>
                      <label htmlFor="b-scope">Comptes</label>
                      <select id="b-scope" value={bScope} onChange={(e) => setBScope(e.target.value)}><option value="all">Tout le budget</option>{CHART.map((s) => <option key={s.k} value={s.k}>{(s.code ? s.code + ' · ' : '') + s.label}</option>)}</select>
                      <select aria-label="Lignes concernées" value={bMode} onChange={(e) => setBMode(e.target.value as any)}><option value="empty">Seulement les lignes vides</option><option value="all">Remplacer les montants existants</option></select>
                      <button type="button" className="li-btn primary" disabled={ro || !years.length} onClick={useAsBase}>Reprendre comme base</button>
                    </div>
                    <p className="li-small" style={{ margin: 0 }}>Si le réalisé mensuel de cette année a été importé, la saisonnalité mois par mois est reprise ; sinon le total annuel du compte est réparti sur 12 mois. Le résultat reste modifiable ligne par ligne.</p>
                    {bMsg ? <div className="li-msg info" role="status">{bMsg}</div> : null}
                  </div>
                </section>
              ) : null}
              {ro ? <p className="bd-hint">Lecture seule : votre rôle ne permet pas de modifier le budget.</p> : <p className="bd-hint">Saisissez directement dans les cellules (mois par mois) ou cliquez sur « An » pour entrer un montant annuel réparti sur 12 mois. Ouvrez un compte (▸) pour la variation en % et les lignes de détail. Montants en € HTVA.</p>}

              <div className="bd-scroll">
                <table className="bd-tbl">
                  <thead>
                    <tr>
                      <th className="lbl" scope="col">Compte</th><th className="tools" scope="col"></th>
                      {shown.map((y) => <th key={y} className="n hist" scope="col">{y}<span>réalisé</span></th>)}
                      {cols.map((c, i) => <th key={i} className={'n ' + (c.t === 'q' ? 'q' : '')} scope="col">{c.t === 'm' ? MONTHS[c.i] : 'T' + (c.i + 1)}</th>)}
                      <th className="n tot" scope="col">Total {year}</th><th className="n delta" scope="col">{refYear != null ? `vs ${refYear}` : ''}</th>
                      {showC ? <th className="cm" scope="col">Commentaire</th> : null}
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
                            <HistCells vals={pick(calc.secH[s.k])} />
                            <MonthCells months={calc.secM[s.k]} cols={cols} />
                            <TotalCells months={calc.secM[s.k]} refv={refOf(calc.secH[s.k])} />
                            {showC ? <td className="cm" /> : null}
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
                                    <HistCells vals={pick(calc.grpH[gk])} />
                                    <MonthCells months={calc.grpM[gk]} cols={cols} />
                                    <TotalCells months={calc.grpM[gk]} refv={refOf(calc.grpH[gk])} />
                                    {showC ? <td className="cm" /> : null}
                                  </tr>
                                ) : null}
                                {gOpen ? g.accounts.map((a) => (
                                  <AccountRows key={a[0]} sec={s} acc={a} entry={plan ? plan.rows[a[0]] : undefined} hist={hist[a[0]]} years={shown} refYear={refYear} open={!!openAcc[a[0]]} ro={ro} cols={cols} showC={showC} onEdit={onEdit} onToggle={toggleAcc} />
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
              <p className="bd-hint">Les sous-totaux, les résultats{showQ ? ' et les trimestres (T1 à T4)' : ''} sont recalculés en temps réel avec les formules du fichier « creation budjet.xlsx ». Années de référence : réalisé annuel par compte (lecture seule), alimenté par l’import d’une année.</p>
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
.bd-chips{display:inline-flex;flex-wrap:wrap;gap:6px;align-items:center}
.bd-switch{display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;user-select:none}
.bd-switch input{appearance:none;width:34px;height:20px;border-radius:999px;background:var(--line);position:relative;cursor:pointer;transition:background .15s;margin:0;border:1px solid var(--muted)}
.bd-switch input::after{content:"";position:absolute;top:1px;left:1px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s;box-shadow:0 1px 2px rgba(0,0,0,.3)}
.bd-switch input:checked{background:var(--brand-2);border-color:var(--brand-2)}
.bd-switch input:checked::after{transform:translateX(14px)}
.bd-switch input:focus-visible{outline:2px solid var(--brand-2);outline-offset:2px}
.bd-tbl td.cm,.bd-tbl th.cm{min-width:260px;width:260px;max-width:260px;padding:0 4px;text-align:left}
.bd-tbl thead th.cm{text-align:left;padding:0 8px}
.bd-cmi{width:100%;height:28px;border:1px solid transparent;border-radius:3px;background:transparent;color:var(--ink);padding:0 6px;font:inherit;font-size:12.5px;text-overflow:ellipsis}
.bd-cmi:hover:not(:disabled){border-color:var(--line);background:var(--surface)}
.bd-cmi:focus{border-color:var(--brand-2);background:var(--surface);outline:none}
.bd-cmi::placeholder{color:transparent}
tr.acc:hover .bd-cmi::placeholder,.bd-cmi:focus::placeholder{color:var(--muted)}
.bd-tbl tr.sec td.cm,.bd-tbl tr.grp td.cm{background:inherit}
.bd-tbl tr.res td.cm{background:var(--brand)}
.bd-modal{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--brand-2);border-radius:6px;padding:12px 16px 16px;margin:8px 0 14px;display:flex;flex-direction:column;gap:10px}
.bd-modal h3{font-size:14px;margin:6px 0 0}
.bd-modal-h{display:flex;justify-content:space-between;align-items:center}
`;
