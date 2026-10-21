'use client';
// app/apps/analyse/AnalyseDashboard.tsx : tableau de bord comparatif + saisie du réel
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CATEGORIES, Kind, MONTHS, MONTHS_LONG, VarianceRow, VolumeRow, eur, favorable, nf, num, pct, pctOf, tone } from '@/lib/finance';
import ActualsEntry from './ActualsEntry';

type Mode = 'month' | 'ytd';
type Agg = { budget: number; actual: number; prev: number };
const add = (a: Agg, r: { budget: number; actual: number; prev_actual: number }): Agg => ({ budget: a.budget + r.budget, actual: a.actual + r.actual, prev: a.prev + r.prev_actual });
const none: Agg = { budget: 0, actual: 0, prev: 0 };

function Delta({ kind, actual, ref, showPct = true }: { kind: Kind; actual: number; ref: number; showPct?: boolean }) {
  const fav = favorable(kind, actual, ref);
  const diff = actual - ref;
  return (
    <span className={`tabular-nums ${tone(fav)}`}>
      {diff > 0 ? '+' : ''}{eur(diff)}{showPct && <small className="ml-1">({pct(pctOf(diff, ref))})</small>}
    </span>
  );
}

export default function AnalyseDashboard({ canEdit }: { canEdit: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const now = new Date();
  const [tab, setTab] = useState<'analyse' | 'saisie'>('analyse');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(0);              // 0 = toute l'année
  const [mode, setMode] = useState<Mode>('ytd');
  const [rows, setRows] = useState<VarianceRow[]>([]);
  const [vols, setVols] = useState<VolumeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [a, b] = await Promise.all([
      supabase.from('v_budget_vs_actual').select('*').eq('year', year),
      supabase.from('v_volumes_compare').select('*').eq('year', year),
    ]);
    if (a.error || b.error) setError((a.error ?? b.error)!.message);
    const clean = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]));
    setRows(((a.data ?? []) as Record<string, unknown>[]).map(clean) as unknown as VarianceRow[]);
    setVols(((b.data ?? []) as Record<string, unknown>[]).map(clean) as unknown as VolumeRow[]);
    setLoading(false);
  }, [supabase, year]);
  useEffect(() => { if (tab === 'analyse') void load(); }, [load, tab]);

  const inPeriod = useCallback((m: number) => month === 0 || (mode === 'month' ? m === month : m <= month), [month, mode]);
  const periodLabel = month === 0 ? `Année ${year}` : mode === 'month' ? `${MONTHS_LONG[month - 1]} ${year}` : `Janvier à ${MONTHS_LONG[month - 1].toLowerCase()} ${year} (cumul)`;

  // agrégats par catégorie sur la période
  const byCat = useMemo(() => CATEGORIES.map((c) => ({
    ...c, agg: rows.filter((r) => r.category === c.code && inPeriod(r.month)).reduce(add, none),
  })), [rows, inPeriod]);
  const kindAgg = (k: Kind) => byCat.filter((c) => c.kind === k).reduce((a, c) => ({ budget: a.budget + c.agg.budget, actual: a.actual + c.agg.actual, prev: a.prev + c.agg.prev }), none);
  const rev = kindAgg('revenu'), cost = kindAgg('cout');
  const res: Agg = { budget: rev.budget - cost.budget, actual: rev.actual - cost.actual, prev: rev.prev - cost.prev };

  // détail mensuel de l'année (résultat)
  const monthly = useMemo(() => MONTHS.map((_, i) => {
    const m = i + 1, rs = rows.filter((r) => r.month === m);
    const f = (k: Kind): Agg => rs.filter((r) => r.kind === k).reduce(add, none);
    const R = f('revenu'), C = f('cout');
    return { m, rev: R, cost: C, res: { budget: R.budget - C.budget, actual: R.actual - C.actual, prev: R.prev - C.prev } as Agg };
  }), [rows]);

  const vol = useMemo(() => vols.filter((v) => inPeriod(v.month)).reduce((a, v) => ({
    bb: a.bb + num(v.budget_brewed), bs: a.bs + num(v.budget_sold), ab: a.ab + num(v.actual_brewed), as: a.as + num(v.actual_sold), pb: a.pb + num(v.prev_brewed), ps: a.ps + num(v.prev_sold),
  }), { bb: 0, bs: 0, ab: 0, as: 0, pb: 0, ps: 0 }), [vols, inPeriod]);

  const th = 'p-2 text-right font-medium';
  const kpi = (title: string, a: Agg, kind: Kind) => (
    <div className="rounded border bg-white p-4">
      <div className="text-sm text-gray-600">{title}</div>
      <div className="text-2xl font-semibold tabular-nums">{eur(a.actual)}</div>
      <div className="mt-1 text-sm">vs budget {eur(a.budget)} : <Delta kind={kind} actual={a.actual} ref={a.budget} /></div>
      <div className="text-sm">vs N-1 {eur(a.prev)} : <Delta kind={kind} actual={a.actual} ref={a.prev} /></div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Année
          <select className="ml-2 rounded border px-2 py-1" value={year} onChange={(e) => setYear(+e.target.value)}>
            {[0, 1, 2, 3, 4].map((d) => now.getFullYear() + 1 - d).map((y) => <option key={y}>{y}</option>)}
          </select></label>
        <label className="text-sm">Mois
          <select className="ml-2 rounded border px-2 py-1" value={month} onChange={(e) => setMonth(+e.target.value)}>
            <option value={0}>Toute l&apos;année</option>
            {MONTHS_LONG.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select></label>
        <div className="inline-flex overflow-hidden rounded border text-sm" role="group" aria-label="Période">
          {([['month', 'Mois seul'], ['ytd', 'Cumul depuis janvier']] as const).map(([k, l]) => (
            <button key={k} disabled={month === 0} onClick={() => setMode(k)} className={`px-3 py-1 ${mode === k && month !== 0 ? 'bg-yellow-400 font-medium' : 'bg-white'} disabled:opacity-40`}>{l}</button>))}
        </div>
        <div className="ml-auto inline-flex overflow-hidden rounded border text-sm" role="tablist">
          <button className={`px-3 py-1 ${tab === 'analyse' ? 'bg-yellow-400 font-medium' : 'bg-white'}`} onClick={() => setTab('analyse')}>Analyse</button>
          {canEdit && <button className={`px-3 py-1 ${tab === 'saisie' ? 'bg-yellow-400 font-medium' : 'bg-white'}`} onClick={() => setTab('saisie')}>Saisie du réel</button>}
        </div>
      </div>

      {tab === 'saisie' && canEdit && <ActualsEntry year={year} defaultMonth={month || now.getMonth() + 1} />}

      {tab === 'analyse' && (loading ? <p>Chargement…</p> : error ? <p className="text-red-700">{error}</p> : (
        <>
          <h2 className="text-lg font-semibold">{periodLabel}</h2>
          {rows.length === 0 && <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">Aucune donnée pour {year}. Saisissez le budget (application Budget) et le réel (onglet « Saisie du réel »).</p>}
          <div className="grid gap-4 md:grid-cols-3">{kpi('Revenus', rev, 'revenu')}{kpi('Coûts', cost, 'cout')}{kpi('Résultat', res, 'revenu')}</div>

          <section className="overflow-x-auto rounded border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50"><tr>
                <th className="p-2 text-left">Catégorie</th><th className={th}>Budget</th><th className={th}>Réel</th><th className={th}>Écart vs budget</th><th className={th}>N-1</th><th className={th}>Écart vs N-1</th></tr></thead>
              <tbody>
                {byCat.map((c) => (
                  <tr key={c.code} className="border-t">
                    <td className="p-2">{c.label}</td>
                    <td className="p-2 text-right tabular-nums">{eur(c.agg.budget)}</td>
                    <td className="p-2 text-right tabular-nums">{eur(c.agg.actual)}</td>
                    <td className="p-2 text-right"><Delta kind={c.kind} actual={c.agg.actual} ref={c.agg.budget} /></td>
                    <td className="p-2 text-right tabular-nums">{eur(c.agg.prev)}</td>
                    <td className="p-2 text-right"><Delta kind={c.kind} actual={c.agg.actual} ref={c.agg.prev} /></td>
                  </tr>))}
                <tr className="border-t-2 bg-yellow-50 font-semibold">
                  <td className="p-2">Résultat</td>
                  <td className="p-2 text-right tabular-nums">{eur(res.budget)}</td><td className="p-2 text-right tabular-nums">{eur(res.actual)}</td>
                  <td className="p-2 text-right"><Delta kind="revenu" actual={res.actual} ref={res.budget} /></td>
                  <td className="p-2 text-right tabular-nums">{eur(res.prev)}</td><td className="p-2 text-right"><Delta kind="revenu" actual={res.actual} ref={res.prev} /></td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="overflow-x-auto rounded border bg-white">
            <h3 className="p-3 font-semibold">Volumes (hL) : {periodLabel}</h3>
            <table className="w-full text-sm">
              <thead className="bg-gray-50"><tr><th className="p-2 text-left" /><th className={th}>Budget</th><th className={th}>Réel</th><th className={th}>Écart vs budget</th><th className={th}>N-1</th><th className={th}>Écart vs N-1</th></tr></thead>
              <tbody>
                {([['Brassés', vol.bb, vol.ab, vol.pb], ['Vendus', vol.bs, vol.as, vol.ps]] as const).map(([l, b, a, p]) => (
                  <tr key={l} className="border-t"><td className="p-2">{l}</td><td className="p-2 text-right tabular-nums">{nf(b)}</td><td className="p-2 text-right tabular-nums">{nf(a)}</td>
                    <td className={`p-2 text-right tabular-nums ${tone(a - b)}`}>{a - b > 0 ? '+' : ''}{nf(a - b)} ({pct(pctOf(a - b, b))})</td>
                    <td className="p-2 text-right tabular-nums">{nf(p)}</td><td className={`p-2 text-right tabular-nums ${tone(a - p)}`}>{a - p > 0 ? '+' : ''}{nf(a - p)} ({pct(pctOf(a - p, p))})</td></tr>))}
              </tbody>
            </table>
          </section>

          <section className="overflow-x-auto rounded border bg-white">
            <h3 className="p-3 font-semibold">Résultat mois par mois, {year}</h3>
            <table className="w-full text-sm">
              <thead className="bg-gray-50"><tr><th className="p-2 text-left">Mois</th><th className={th}>Revenus réels</th><th className={th}>Coûts réels</th><th className={th}>Résultat réel</th><th className={th}>Résultat budget</th><th className={th}>Écart</th><th className={th}>Résultat N-1</th><th className={th}>Écart N-1</th></tr></thead>
              <tbody>
                {monthly.map((x) => (
                  <tr key={x.m} className={`border-t ${month === x.m ? 'bg-yellow-50' : ''}`}>
                    <td className="p-2">{MONTHS[x.m - 1]}</td>
                    <td className="p-2 text-right tabular-nums">{eur(x.rev.actual)}</td><td className="p-2 text-right tabular-nums">{eur(x.cost.actual)}</td>
                    <td className="p-2 text-right font-medium tabular-nums">{eur(x.res.actual)}</td><td className="p-2 text-right tabular-nums">{eur(x.res.budget)}</td>
                    <td className="p-2 text-right"><Delta kind="revenu" actual={x.res.actual} ref={x.res.budget} showPct={false} /></td>
                    <td className="p-2 text-right tabular-nums">{eur(x.res.prev)}</td><td className="p-2 text-right"><Delta kind="revenu" actual={x.res.actual} ref={x.res.prev} showPct={false} /></td>
                  </tr>))}
              </tbody>
            </table>
            <p className="p-3 text-xs text-gray-500">Vert : écart favorable (revenus au-dessus ou coûts en dessous de la référence). Rouge : écart défavorable.</p>
          </section>
        </>
      ))}
    </div>
  );
}
