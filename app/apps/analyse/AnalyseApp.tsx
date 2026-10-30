'use client';
/* =====================================================================
   app/apps/analyse/AnalyseApp.tsx : Reporting : réalisé vs budget validé vs N-1
   - courbes mensuelles interactives du CA (ou d'un autre indicateur) ; superposition d'autres années ; cumul
   - vue détaillée par sous-catégorie / canal (comptes de la classe, lignes de détail du budget)
   - tableau de comparaison au mois, au trimestre ou à l'année (trimestres masquables)
   - import du réalisé (export Odoo, Excel, CSV)
   ===================================================================== */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import LedgerImport, { LI_CSS } from '@/components/LedgerImport';
import { createClient } from '@/lib/supabase/client';
import { CHART, METRICS, MONTHS, MONTHS_LONG, Z12, accMonths, cloneEntry, eur0, fmt0, sum, type Plan } from '@/lib/pcmn';
import { LineChart, StackedChart, type Series } from './CaChart';
import { AN_CSS } from './styles';
import { aggregate, cumulative, detailKeys, higherIsBetter, metric, metricAnnual, periods, planAccts, realizedMonths, sectionOf, type Accts, type Actuals } from './compute';

const PREFS = 'badjawe-analyse-prefs';
const PALETTE = ['#2A8C82', '#B5651D', '#7B5EA7', '#C0392B', '#3D6FB6', '#8A9A2B', '#D97BA0', '#5C5C5C'];
const C_REAL = '#012735', C_BUD = '#D6AD00', C_N1 = '#7C8F98';

async function fetchAll(q: (a: number, b: number) => any): Promise<{ data: any[]; error: any }> {
  const out: any[] = [];
  for (let i = 0; i < 200; i++) { const r = await q(i * 1000, i * 1000 + 999); if (r.error) return { data: out, error: r.error }; out.push(...(r.data || [])); if (!r.data || r.data.length < 1000) break; }
  return { data: out, error: null };
}
type PlanRow = { year: number; data: Plan | null; validated_data: Plan | null; validated_at: string | null };
const pct = (a: number | null, b: number | null) => (a == null || b == null || Math.abs(b) < 0.5 ? '—' : (a - b >= 0 ? '+' : '−') + new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 1 }).format(Math.abs(((a - b) / Math.abs(b)) * 100)) + ' %');
const sgn = (n: number) => (n >= 0 ? '+' : '−') + fmt0(Math.abs(n));
const readPrefs = (): { showQ?: boolean } => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch { return {}; } };
const normPlan = (p: any): Plan => { const rows: Plan['rows'] = {}; if (p && p.rows) Object.keys(p.rows).forEach((k) => { rows[k] = cloneEntry(p.rows[k]); }); return { v: 1, rows }; };

export default function AnalyseApp({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const routerRef = useRef(router); routerRef.current = router;
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [act, setAct] = useState<Actuals>({});
  const [actMonths, setActMonths] = useState<Record<number, Set<number>>>({});
  const [hist, setHist] = useState<Record<string, Record<number, number>>>({});
  const [plans, setPlans] = useState<Record<number, PlanRow>>({});
  const [year, setYear] = useState<number | null>(null);
  const [mid, setMid] = useState('s70');
  const [cmp, setCmp] = useState<Record<number, boolean>>({});
  const [view, setView] = useState<'curves' | 'detail'>('curves');
  const [cum, setCum] = useState(false);
  const [gran, setGran] = useState<'month' | 'quarter' | 'year'>('month');
  const [showQ, setShowQ] = useState(true);
  const [src, setSrc] = useState<'validated' | 'draft'>('validated');
  const [dsrc, setDsrc] = useState<'real' | 'budget' | 'n1'>('real');
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => { const p = readPrefs(); if (typeof p.showQ === 'boolean') setShowQ(p.showQ); }, []);
  const setQ = (v: boolean) => { setShowQ(v); if (!v && gran === 'quarter') setGran('month'); try { localStorage.setItem(PREFS, JSON.stringify({ showQ: v })); } catch { /* ignoré */ } };

  const firstLoad = useRef(true);
  const load = useCallback(async () => {
    if (firstLoad.current) setLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth || !auth.user) { routerRef.current.replace('/login?next=/apps/analyse'); return; }
      const [a, h, p] = await Promise.all([
        fetchAll((x, y) => supabase.from('pcmn_actuals').select('account_key,year,month,amount').range(x, y)),
        fetchAll((x, y) => supabase.from('pcmn_budget_history').select('account_key,year,amount').range(x, y)),
        supabase.from('pcmn_budget_plans').select('year,data,validated_data,validated_at'),
      ]);
      const err = a.error || h.error || p.error;
      setNotice(err ? (/relation|does not exist|schema cache|validated/i.test(err.message || '') ? 'Tables manquantes : exécutez sql/02_budget_pcmn.sql puis sql/04_admin_reel_validation.sql dans Supabase (SQL Editor), puis rechargez la page.' : 'Chargement impossible : ' + err.message) : '');
      const A: Actuals = {}, M: Record<number, Set<number>> = {};
      a.data.forEach((r: any) => { ((A[r.year] = A[r.year] || {})[r.account_key] = A[r.year][r.account_key] || Z12())[r.month - 1] = Number(r.amount); (M[r.year] = M[r.year] || new Set()).add(r.month); });
      const H: Record<string, Record<number, number>> = {};
      h.data.forEach((r: any) => { (H[r.account_key] = H[r.account_key] || {})[r.year] = Number(r.amount); });
      const P: Record<number, PlanRow> = {};
      ((p.data || []) as any[]).forEach((r) => { P[r.year] = { year: r.year, data: r.data ? normPlan(r.data) : null, validated_data: r.validated_data ? normPlan(r.validated_data) : null, validated_at: r.validated_at || null }; });
      setAct(A); setActMonths(M); setHist(H); setPlans(P);
      setYear((y) => y ?? (Object.keys(A).length ? Math.max(...Object.keys(A).map(Number)) : Object.keys(P).length ? Math.max(...Object.keys(P).map(Number)) : 2026));
    } catch (e: any) { setNotice('Chargement impossible : ' + (e && e.message ? e.message : 'erreur réseau')); }
    firstLoad.current = false; setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  /* ---- années et sources ---- */
  const histYears = useMemo(() => { const s = new Set<number>(); Object.values(hist).forEach((o) => Object.keys(o).forEach((y) => s.add(+y))); return s; }, [hist]);
  const allYears = useMemo(() => [...new Set<number>([...Object.keys(act).map(Number), ...histYears, ...Object.keys(plans).map(Number), ...(year ? [year] : [])])].sort((a, b) => a - b), [act, histYears, plans, year]);
  const Y = year ?? 2026;
  const planRow = plans[Y];
  const hasValidated = !!(planRow && planRow.validated_data);
  const usingValidated = src === 'validated' && hasValidated;
  const budgetPlan: Plan | null = planRow ? (usingValidated ? planRow.validated_data : planRow.data) : null;

  /* ---- séries d'un indicateur pour une année ---- */
  const annualOf = useCallback((y: number, id: string): number | null => {
    if (!histYears.has(y)) return null;
    const t: Record<string, number> = {}; Object.entries(hist).forEach(([k, o]) => { if (o[y] !== undefined) t[k] = o[y]; });
    return metricAnnual(t, id);
  }, [hist, histYears]);
  const realOf = useCallback((y: number, id: string): number[] | null => (act[y] ? metric(act[y], id) : null), [act]);
  const last = realizedMonths(act[Y], actMonths[Y]);
  const budM = useMemo(() => (budgetPlan ? metric(planAccts(budgetPlan), mid) : null), [budgetPlan, mid]);
  const n1M = useMemo(() => realOf(Y - 1, mid), [realOf, Y, mid]);
  const n1A = annualOf(Y - 1, mid);
  const realM = useMemo(() => realOf(Y, mid), [realOf, Y, mid]);
  const better = higherIsBetter(mid);

  /* ---- courbes ---- */
  const toSeries = (v: number[] | null, lim: number): (number | null)[] => (v ? v.map((x, i) => (i < lim ? x : null)) : Array(12).fill(null));
  const series: Series[] = useMemo(() => {
    const out: Series[] = [];
    const push = (s: Series) => { if (s.values.some((v) => v != null)) { out.push({ ...s, values: cum ? cumulative(s.values) : s.values }); } };
    push({ id: 'real', label: `Réalisé ${Y}`, color: C_REAL, values: toSeries(realM, last), width: 3 });
    if (budM) push({ id: 'bud', label: `Budget ${Y} (${usingValidated ? 'validé' : 'brouillon'})`, color: C_BUD, dash: true, values: budM.slice() });
    if (n1M) push({ id: 'n1', label: `N-1 (${Y - 1})`, color: C_N1, values: n1M.slice() });
    else if (n1A != null) push({ id: 'n1', label: `N-1 (${Y - 1}), moyenne mensuelle`, color: C_N1, dash: true, values: Array(12).fill(n1A / 12), note: 'Seul le total annuel est connu : importez le réalisé mensuel de cette année pour voir la courbe réelle.' });
    let ci = 0;
    allYears.filter((y) => cmp[y] && y !== Y && !(y === Y - 1)).forEach((y) => {
      const color = PALETTE[ci++ % PALETTE.length];
      const r = realOf(y, mid), a = annualOf(y, mid), pl = plans[y];
      if (r) push({ id: 'y' + y, label: String(y), color, values: r.slice() });
      else if (a != null) push({ id: 'y' + y, label: `${y} (moyenne mensuelle)`, color, dash: true, values: Array(12).fill(a / 12) });
      else if (pl && pl.data) push({ id: 'y' + y, label: `${y} (budget)`, color, dash: true, values: metric(planAccts(pl.validated_data || pl.data), mid) });
    });
    return out;
  }, [realM, budM, n1M, n1A, last, cum, Y, usingValidated, cmp, allYears, mid, plans, realOf, annualOf]);

  /* ---- vue détaillée : un segment par compte (ou ligne de détail du budget) ---- */
  const detailSeries: Series[] = useMemo(() => {
    const sec = sectionOf(mid); if (!sec) return [];
    const keys = detailKeys(mid);
    const labelOf = (k: string) => { for (const g of sec.groups) for (const a of g.accounts) if (a[0] === k) return (a[1].startsWith('x') ? '' : a[1] + ' ') + a[2]; return k; };
    const raw: { id: string; label: string; v: number[] }[] = [];
    keys.forEach((k) => {
      if (dsrc === 'real') { const m = act[Y] && act[Y][k]; if (m) raw.push({ id: k, label: labelOf(k), v: m.map((x, i) => (i < last ? x : 0)) }); }
      else if (dsrc === 'n1') { const m = act[Y - 1] && act[Y - 1][k]; if (m) raw.push({ id: k, label: labelOf(k), v: m.slice() }); }
      else if (budgetPlan && budgetPlan.rows[k]) {
        const e = budgetPlan.rows[k];
        if (e.subs.length) e.subs.forEach((s) => { const v = accMonths({ ...e, subs: [s] }); if (v.some((x) => Math.abs(x) > 0.005)) raw.push({ id: k + ':' + s.id, label: `${s.label} (${labelOf(k).split(' ')[0]})`, v }); });
        else { const v = accMonths(e); if (v.some((x) => Math.abs(x) > 0.005)) raw.push({ id: k, label: labelOf(k), v }); }
      }
    });
    raw.sort((a, b) => Math.abs(sum(b.v)) - Math.abs(sum(a.v)));
    const top = raw.slice(0, 8), rest = raw.slice(8);
    const out: Series[] = top.map((r, i) => ({ id: r.id, label: r.label, color: PALETTE[i % PALETTE.length], values: r.v }));
    if (rest.length) out.push({ id: 'other', label: `Autres (${rest.length})`, color: '#B9C2C6', values: Z12().map((_, i) => rest.reduce((a, r) => a + r.v[i], 0)) });
    return cum ? out.map((s) => ({ ...s, values: cumulative(s.values) })) : out;
  }, [mid, dsrc, act, Y, last, budgetPlan, cum]);

  /* ---- tableau de comparaison ---- */
  const rows = useMemo(() => periods(gran, showQ, MONTHS, Y).map((p) => ({ p, a: aggregate(p.months, last, realM, budM, n1M, n1A) })), [gran, showQ, Y, last, realM, budM, n1M, n1A]);
  const ytd = useMemo(() => aggregate(Array.from({ length: last }, (_, i) => i), last, realM, budM, n1M, n1A), [last, realM, budM, n1M, n1A]);
  const full = useMemo(() => aggregate(Array.from({ length: 12 }, (_, i) => i), last, realM, budM, n1M, n1A), [last, realM, budM, n1M, n1A]);
  const tone = (d: number | null) => (d == null || Math.abs(d) < 0.5 ? '' : (d > 0) === better ? 'good' : 'bad');
  const hasReal = last > 0;
  const metricLabel = METRICS.find((m) => m.id === mid)?.label || mid;
  const isSection = !!sectionOf(mid);
  const dVsBud = hasReal && ytd.budCmp != null && ytd.real != null ? ytd.real - ytd.budCmp : null;
  const dVsN1 = hasReal && ytd.n1Cmp != null && ytd.real != null ? ytd.real - ytd.n1Cmp : null;

  const right = <span className={'an-badge ' + (budgetPlan ? (usingValidated ? 'ok' : 'warn') : '')} title={usingValidated && planRow?.validated_at ? 'Budget validé le ' + new Date(planRow.validated_at).toLocaleDateString('fr-BE') : ''}>{budgetPlan ? (usingValidated ? `Budget ${Y} validé` : `Budget ${Y} : brouillon`) : `Pas de budget ${Y}`}</span>;
  const chipYears = allYears.filter((y) => y !== Y && y !== Y - 1);

  return (
    <>
      <AppHeader title="Reporting" right={right} />
      <style dangerouslySetInnerHTML={{ __html: AN_CSS + LI_CSS }} />
      <div className="an-root"><main className="an-wrap">
        {notice ? <div className="an-alert" role="alert">{notice}</div> : null}
        {loading ? <p className="an-empty">Chargement…</p> : (
          <>
            <section className="an-card" aria-label="Paramètres">
              <div className="an-bar">
                <label className="an-lbl" htmlFor="an-year">Année analysée</label>
                <select id="an-year" value={Y} onChange={(e) => setYear(+e.target.value)}>{allYears.map((y) => <option key={y} value={y}>{y}</option>)}</select>
                <label className="an-lbl" htmlFor="an-metric">Indicateur</label>
                <select id="an-metric" value={mid} onChange={(e) => setMid(e.target.value)}>{METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
                {hasValidated ? (
                  <><label className="an-lbl" htmlFor="an-src">Budget de référence</label>
                    <select id="an-src" value={src} onChange={(e) => setSrc(e.target.value as any)}><option value="validated">Budget validé</option><option value="draft">Brouillon en cours</option></select></>
                ) : planRow && planRow.data ? <span className="an-badge warn" title="Le budget de cette année n’a pas été validé par un administrateur">Budget non validé : brouillon utilisé</span> : null}
                <span style={{ flex: 1 }} />
                <button type="button" className="an-btn" aria-expanded={importOpen} onClick={() => setImportOpen((v) => !v)}>⭳ Importer le réalisé (Odoo)</button>
              </div>
              {importOpen ? (
                <div style={{ marginTop: 12 }}>
                  <LedgerImport defaultYear={Y} canWrite={canEdit} onImported={async (ys) => { await load(); if (ys.length) setYear(Math.max(...ys)); }} />
                </div>
              ) : null}
            </section>

            {!hasReal && !budM ? (
              <div className="an-empty">Aucun chiffre pour {Y}. Importez un export Odoo (bouton ci-dessus) ou saisissez un budget dans l’application Budget.</div>
            ) : null}

            <section className="an-kpis" aria-label="Synthèse">
              <div className="an-kpi"><div className="l">Réalisé {hasReal ? `(jan. – ${MONTHS_LONG[last - 1].toLowerCase()})` : ''}</div><div className="v">{ytd.real == null ? '—' : eur0(ytd.real)}</div><div className="s">{metricLabel}</div></div>
              <div className="an-kpi" title="Comparaison sur les mêmes mois"><div className="l">vs budget {usingValidated ? 'validé' : '(brouillon)'}</div><div className={'v ' + tone(dVsBud)}>{dVsBud == null ? '—' : sgn(dVsBud) + ' €'}</div><div className="s">{ytd.budCmp == null ? 'Pas de budget' : `Budget : ${eur0(ytd.budCmp)} · ${pct(ytd.real, ytd.budCmp)}`}</div></div>
              <div className="an-kpi" title="Comparaison sur les mêmes mois"><div className="l">vs N-1 ({Y - 1})</div><div className={'v ' + tone(dVsN1)}>{dVsN1 == null ? '—' : sgn(dVsN1) + ' €'}</div><div className="s">{ytd.n1Cmp == null ? (n1A != null ? 'N-1 annuel seulement' : 'Pas de N-1') : `N-1 : ${eur0(ytd.n1Cmp)} · ${pct(ytd.real, ytd.n1Cmp)}`}</div></div>
              <div className="an-kpi"><div className="l">Budget {Y} (année)</div><div className="v">{full.budget == null ? '—' : eur0(full.budget)}</div><div className="s">{full.budget != null && ytd.real != null ? `${new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 }).format(Math.round((ytd.real / (full.budget || 1)) * 100))} % réalisé` : ''}</div></div>
            </section>

            <section className="an-card" aria-label="Graphique">
              <div className="an-bar" style={{ marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>{view === 'curves' ? `${metricLabel} par mois` : `Détail : ${metricLabel}`}</h2>
                <span style={{ flex: 1 }} />
                <span className="an-seg" role="group" aria-label="Type de vue">
                  <button type="button" aria-pressed={view === 'curves'} onClick={() => setView('curves')}>Courbes</button>
                  <button type="button" aria-pressed={view === 'detail'} onClick={() => setView('detail')} title="Répartition par sous-catégorie / canal de vente">Vue détaillée</button>
                </span>
                <label className="an-switch"><input type="checkbox" role="switch" checked={cum} onChange={(e) => setCum(e.target.checked)} /><span>Cumulé</span></label>
              </div>
              {view === 'curves' ? (
                <>
                  <div className="an-bar" style={{ marginBottom: 8 }} role="group" aria-label="Années à superposer">
                    <span className="an-lbl">Comparer avec</span>
                    {chipYears.length ? chipYears.map((y) => <button key={y} type="button" className="an-btn sm" aria-pressed={!!cmp[y]} onClick={() => setCmp((o) => ({ ...o, [y]: !o[y] }))}>{y}</button>) : <span className="an-note" style={{ margin: 0 }}>aucune autre année disponible</span>}
                  </div>
                  {series.length ? <LineChart series={series} label={`${metricLabel} par mois, ${Y}, réalisé, budget et années de comparaison`} /> : <div className="an-empty">Aucune donnée à afficher.</div>}
                  <p className="an-note">Survolez le graphique (ou utilisez les flèches du clavier) pour lire les montants d’un mois. Cliquez sur la légende pour masquer une courbe. Les courbes en pointillés sont le budget ou des moyennes mensuelles (années dont seul le total annuel est connu).</p>
                </>
              ) : !isSection ? (
                <div className="an-empty">La vue détaillée est disponible pour le chiffre d’affaires et les postes de charges. Choisissez un de ces indicateurs.</div>
              ) : (
                <>
                  <div className="an-det">
                    <span className="an-lbl">Données</span>
                    <span className="an-seg" role="group" aria-label="Source des données">
                      <button type="button" aria-pressed={dsrc === 'real'} onClick={() => setDsrc('real')}>Réalisé {Y}</button>
                      <button type="button" aria-pressed={dsrc === 'budget'} onClick={() => setDsrc('budget')}>Budget {Y}</button>
                      <button type="button" aria-pressed={dsrc === 'n1'} onClick={() => setDsrc('n1')}>N-1 ({Y - 1})</button>
                    </span>
                  </div>
                  {detailSeries.length ? <StackedChart series={detailSeries} label={`${metricLabel} par mois et par sous-catégorie`} /> : <div className="an-empty">Aucune donnée détaillée pour cette source : {dsrc === 'budget' ? 'saisissez le budget par compte ou par ligne de détail.' : 'importez le réalisé mensuel de cette année.'}</div>}
                  <p className="an-note">{dsrc === 'budget' ? 'Budget : les lignes de détail saisies (ex. Vente Horeca, Grande distribution) apparaissent comme canaux distincts.' : 'Réalisé : un segment par compte comptable du plan (ex. 701000 produits finis, 700400 événements…). Les 8 plus gros comptes sont affichés, les autres sont regroupés.'}</p>
                </>
              )}
            </section>

            <section className="an-card" aria-label="Comparaison">
              <div className="an-bar" style={{ marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>Réalisé, budget et N-1</h2>
                <span style={{ flex: 1 }} />
                <span className="an-seg" role="group" aria-label="Granularité">
                  <button type="button" aria-pressed={gran === 'month'} onClick={() => setGran('month')}>Mois</button>
                  <button type="button" aria-pressed={gran === 'quarter'} disabled={!showQ} onClick={() => setGran('quarter')} title={showQ ? '' : 'Activez l’affichage des trimestres'}>Trimestre</button>
                  <button type="button" aria-pressed={gran === 'year'} onClick={() => setGran('year')}>Année</button>
                </span>
                <label className="an-switch"><input type="checkbox" role="switch" checked={showQ} onChange={(e) => setQ(e.target.checked)} /><span>Afficher les trimestres</span></label>
              </div>
              <div className="an-scroll">
                <table className="an-tbl">
                  <thead><tr><th scope="col">{gran === 'year' ? 'Période' : gran === 'quarter' ? 'Trimestre' : 'Mois'}</th><th scope="col">Réalisé {Y}</th><th scope="col">Budget</th><th scope="col">Écart vs budget</th><th scope="col">%</th><th scope="col">N-1</th><th scope="col">Écart vs N-1</th><th scope="col">%</th></tr></thead>
                  <tbody>
                    {rows.map(({ p, a }, i) => {
                      const dB = a.real != null && a.budCmp != null ? a.real - a.budCmp : null, dN = a.real != null && a.n1Cmp != null ? a.real - a.n1Cmp : null;
                      const partial = a.done > 0 && a.done < a.total;
                      return (
                        <tr key={i} className={(p.kind !== 'm' ? 'q ' : '') + (a.done === 0 ? 'fut' : '')}>
                          <th scope="row">{p.label}{partial ? <span className="an-badge" style={{ marginLeft: 6 }} title={`Réalisé sur ${a.done} mois sur ${a.total} : écarts calculés sur ces mois`}>{a.done}/{a.total}</span> : null}</th>
                          <td className="n">{a.real == null ? '—' : fmt0(a.real)}</td>
                          <td className="n">{a.budget == null ? '—' : fmt0(a.budget)}</td>
                          <td className={'n ' + tone(dB)}>{dB == null ? '—' : sgn(dB)}</td><td className={'n ' + tone(dB)}>{pct(a.real, a.budCmp)}</td>
                          <td className="n">{a.n1 == null ? '—' : fmt0(a.n1)}</td>
                          <td className={'n ' + tone(dN)}>{dN == null ? '—' : sgn(dN)}</td><td className={'n ' + tone(dN)}>{pct(a.real, a.n1Cmp)}</td>
                        </tr>
                      );
                    })}
                    {gran !== 'year' ? (
                      <>
                        <tr className="tot"><th scope="row">{hasReal ? `Cumul jan. – ${MONTHS[last - 1].replace('.', '')}` : 'Cumul'}</th>
                          <td className="n">{ytd.real == null ? '—' : fmt0(ytd.real)}</td><td className="n">{ytd.budCmp == null ? '—' : fmt0(ytd.budCmp)}</td>
                          <td className={'n ' + tone(dVsBud)}>{dVsBud == null ? '—' : sgn(dVsBud)}</td><td className={'n ' + tone(dVsBud)}>{pct(ytd.real, ytd.budCmp)}</td>
                          <td className="n">{ytd.n1Cmp == null ? '—' : fmt0(ytd.n1Cmp)}</td><td className={'n ' + tone(dVsN1)}>{dVsN1 == null ? '—' : sgn(dVsN1)}</td><td className={'n ' + tone(dVsN1)}>{pct(ytd.real, ytd.n1Cmp)}</td></tr>
                        <tr className="q"><th scope="row">Année complète</th><td className="n">—</td><td className="n">{full.budget == null ? '—' : fmt0(full.budget)}</td><td className="n" colSpan={2}></td><td className="n">{full.n1 == null ? '—' : fmt0(full.n1)}</td><td className="n" colSpan={2}></td></tr>
                      </>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <p className="an-note">Montants en € HTVA. {better ? 'Vert : au-dessus du budget ou de N-1.' : 'Vert : en dessous du budget ou de N-1 (charges).'} Les écarts sont calculés sur les mêmes mois que le réalisé. {!n1M && n1A != null ? `N-1 : seul le total annuel ${Y - 1} est connu (pas de détail mensuel) : importez l’export Odoo ${Y - 1} pour comparer mois par mois.` : ''}{!usingValidated && budM ? ' Le budget utilisé est le brouillon : un administrateur peut le valider dans l’application Budget.' : ''}</p>
            </section>
          </>
        )}
      </main></div>
    </>
  );
}
