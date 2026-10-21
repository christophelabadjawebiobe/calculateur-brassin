'use client';
// app/apps/budget/BudgetEditor.tsx : saisie / édition du budget + vue récapitulative
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CATEGORIES, CategoryCode, KIND_OF, MONTHS, eur, nf, num, pct, pctOf } from '@/lib/finance';

type Line = { category: CategoryCode; label: string; amounts: number[] };
type Vol = { brewed: number[]; sold: number[] };
const zeros = () => Array<number>(12).fill(0);
const emptyVol = (): Vol => ({ brewed: zeros(), sold: zeros() });
const keyOf = (l: Pick<Line, 'category' | 'label'>) => `${l.category}|${l.label.trim()}`;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export default function BudgetEditor({ canEdit }: { canEdit: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [planId, setPlanId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [vol, setVol] = useState<Vol>(emptyVol());
  const [saved, setSaved] = useState<string[]>([]);           // clés présentes en base (pour détecter les suppressions)
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  /** Lit le budget actif d'une année (lignes + volumes) */
  const fetchYear = useCallback(async (y: number) => {
    const { data: plan, error } = await supabase.from('budget_plans').select('id').eq('year', y).eq('is_active', true).maybeSingle();
    if (error) throw error;
    if (!plan) return { planId: null as string | null, lines: [] as Line[], vol: emptyVol() };
    const [l, v] = await Promise.all([
      supabase.from('budget_lines').select('month,category,label,amount').eq('plan_id', plan.id),
      supabase.from('budget_volumes').select('month,hl_brewed,hl_sold').eq('plan_id', plan.id),
    ]);
    if (l.error) throw l.error;
    if (v.error) throw v.error;
    const map = new Map<string, Line>();
    (l.data ?? []).forEach((r) => {
      const k = keyOf(r as any);
      if (!map.has(k)) map.set(k, { category: r.category as CategoryCode, label: r.label, amounts: zeros() });
      map.get(k)!.amounts[r.month - 1] = num(r.amount);
    });
    const vol = emptyVol();
    (v.data ?? []).forEach((r) => { vol.brewed[r.month - 1] = num(r.hl_brewed); vol.sold[r.month - 1] = num(r.hl_sold); });
    const order = (c: CategoryCode) => CATEGORIES.findIndex((x) => x.code === c);
    const lines = [...map.values()].sort((a, b) => order(a.category) - order(b.category) || a.label.localeCompare(b.label));
    return { planId: plan.id as string, lines, vol };
  }, [supabase]);

  const load = useCallback(async (y: number) => {
    setLoading(true); setMsg(null);
    try {
      const r = await fetchYear(y);
      setPlanId(r.planId); setLines(r.lines); setVol(r.vol); setSaved(r.lines.map(keyOf)); setDirty(false);
    } catch (e) {
      setMsg({ type: 'err', text: `Chargement impossible : ${(e as Error).message}` });
    } finally { setLoading(false); }
  }, [fetchYear]);

  useEffect(() => { void load(year); }, [year, load]);

  // ---- édition ----
  const touch = () => { setDirty(true); setMsg(null); };
  const setAmount = (i: number, m: number, v: string) => { setLines((ls) => ls.map((l, j) => j !== i ? l : { ...l, amounts: l.amounts.map((a, k) => k === m ? Math.max(0, num(v)) : a) })); touch(); };
  const setLabel = (i: number, v: string) => { setLines((ls) => ls.map((l, j) => j === i ? { ...l, label: v } : l)); touch(); };
  const addLine = (category: CategoryCode) => { setLines((ls) => [...ls, { category, label: '', amounts: zeros() }]); touch(); };
  const removeLine = (i: number) => { setLines((ls) => ls.filter((_, j) => j !== i)); touch(); };
  const fill = (i: number, v: number) => { setLines((ls) => ls.map((l, j) => j === i ? { ...l, amounts: Array<number>(12).fill(v) } : l)); touch(); };
  const setVolume = (kind: 'brewed' | 'sold', m: number, v: string) => { setVol((x) => ({ ...x, [kind]: x[kind].map((a, k) => k === m ? Math.max(0, num(v)) : a) })); touch(); };

  /** Reprend le budget de l'année précédente dans l'éditeur (rien n'est enregistré avant « Enregistrer ») */
  const copyPrevious = async () => {
    if (lines.length && !confirm(`Remplacer les lignes de ${year} par celles de ${year - 1} ?`)) return;
    try {
      const r = await fetchYear(year - 1);
      if (!r.lines.length) { setMsg({ type: 'err', text: `Aucun budget actif trouvé pour ${year - 1}.` }); return; }
      setLines(r.lines); setVol(r.vol); touch();
      setMsg({ type: 'ok', text: `Budget ${year - 1} repris : ajustez puis enregistrez.` });
    } catch (e) { setMsg({ type: 'err', text: (e as Error).message }); }
  };

  const save = async () => {
    const cleaned = lines.map((l) => ({ ...l, label: l.label.trim() }));
    const keys = cleaned.map(keyOf);
    if (new Set(keys).size !== keys.length) { setMsg({ type: 'err', text: 'Deux lignes ont la même catégorie et le même libellé : rendez-les uniques.' }); return; }
    setSaving(true); setMsg(null);
    try {
      let id = planId;
      if (!id) {
        const { data, error } = await supabase.from('budget_plans').insert({ year, name: 'Budget', is_active: true }).select('id').single();
        if (error) throw error;
        id = data.id as string; setPlanId(id);
      }
      // 1. suppression des lignes retirées (ou renommées)
      for (const k of saved.filter((k) => !keys.includes(k))) {
        const [category, ...rest] = k.split('|');
        const { error } = await supabase.from('budget_lines').delete().eq('plan_id', id).eq('category', category).eq('label', rest.join('|'));
        if (error) throw error;
      }
      // 2. upsert des 12 mois de chaque ligne
      const rows = cleaned.flatMap((l) => l.amounts.map((amount, i) => ({ plan_id: id, month: i + 1, category: l.category, label: l.label, amount })));
      if (rows.length) {
        const { error } = await supabase.from('budget_lines').upsert(rows, { onConflict: 'plan_id,month,category,label' });
        if (error) throw error;
      }
      // 3. volumes
      const vrows = MONTHS.map((_, i) => ({ plan_id: id, month: i + 1, hl_brewed: vol.brewed[i], hl_sold: vol.sold[i] }));
      const { error: ve } = await supabase.from('budget_volumes').upsert(vrows, { onConflict: 'plan_id,month' });
      if (ve) throw ve;
      setLines(cleaned); setSaved(keys); setDirty(false);
      setMsg({ type: 'ok', text: `Budget ${year} enregistré.` });
    } catch (e) {
      setMsg({ type: 'err', text: `Enregistrement impossible : ${(e as Error).message}` });
    } finally { setSaving(false); }
  };

  // ---- récapitulatif ----
  const recap = useMemo(() => {
    const byCat = CATEGORIES.map((c) => ({ ...c, months: lines.filter((l) => l.category === c.code).reduce((acc, l) => acc.map((v, i) => v + l.amounts[i]), zeros()) }));
    const rev = zeros(), cost = zeros();
    byCat.forEach((c) => c.months.forEach((v, i) => { if (c.kind === 'revenu') rev[i] += v; else cost[i] += v; }));
    const result = rev.map((v, i) => v - cost[i]);
    return { byCat, rev, cost, result };
  }, [lines]);
  const totRev = sum(recap.rev), totCost = sum(recap.cost), totRes = totRev - totCost;
  const ro = !canEdit;

  const input = 'w-full min-w-[68px] rounded border border-gray-300 px-1 py-0.5 text-right tabular-nums disabled:bg-gray-100';
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Année
          <select className="ml-2 rounded border px-2 py-1" value={year} onChange={(e) => { if (!dirty || confirm('Abandonner les modifications non enregistrées ?')) setYear(+e.target.value); }}>
            {[thisYear - 2, thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => <option key={y}>{y}</option>)}
          </select>
        </label>
        {canEdit && <button className="rounded bg-yellow-500 px-3 py-1.5 font-medium text-black disabled:opacity-50" onClick={save} disabled={saving || loading || !dirty}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>}
        {canEdit && <button className="rounded border px-3 py-1.5" onClick={copyPrevious} disabled={loading}>Reprendre le budget {year - 1}</button>}
        {dirty && <span className="text-sm text-amber-700">Modifications non enregistrées</span>}
        {!canEdit && <span className="text-sm text-gray-600">Lecture seule</span>}
        {msg && <span className={`text-sm ${msg.type === 'ok' ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</span>}
      </div>

      {loading ? <p>Chargement…</p> : (
        <>
          <section className="overflow-x-auto rounded border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="sticky left-0 z-10 min-w-[200px] bg-gray-50 p-2 text-left">Poste</th>
                  {MONTHS.map((m) => <th key={m} className="p-2 text-right">{m}</th>)}
                  <th className="p-2 text-right">Total {year}</th><th />
                </tr>
              </thead>
              {CATEGORIES.map((c) => {
                const idx = lines.map((l, i) => ({ l, i })).filter((x) => x.l.category === c.code);
                const cm = recap.byCat.find((x) => x.code === c.code)!.months;
                return (
                  <tbody key={c.code}>
                    <tr className="bg-gray-100 font-semibold"><td className="sticky left-0 bg-gray-100 p-2" colSpan={1}>{c.label} <span className="text-xs font-normal text-gray-500">({c.kind === 'revenu' ? 'revenu' : 'coût'})</span></td>
                      {cm.map((v, i) => <td key={i} className="p-2 text-right tabular-nums">{eur(v)}</td>)}
                      <td className="p-2 text-right tabular-nums">{eur(sum(cm))}</td><td /></tr>
                    {idx.map(({ l, i }) => (
                      <tr key={i} className="border-t">
                        <td className="sticky left-0 bg-white p-1"><input className="w-full rounded border border-gray-300 px-1 py-0.5 disabled:bg-gray-100" value={l.label} placeholder="Libellé (ex. Ventes HORECA)" disabled={ro} onChange={(e) => setLabel(i, e.target.value)} /></td>
                        {l.amounts.map((a, m) => <td key={m} className="p-1"><input className={input} type="number" min={0} step="0.01" value={a || ''} disabled={ro} onChange={(e) => setAmount(i, m, e.target.value)} onFocus={(e) => e.target.select()} /></td>)}
                        <td className="p-2 text-right tabular-nums">{eur(sum(l.amounts))}</td>
                        <td className="whitespace-nowrap p-1">{canEdit && <>
                          <button className="px-1 text-xs underline" title="Copier le montant de janvier sur 12 mois" onClick={() => fill(i, l.amounts[0])}>=12×</button>
                          <button className="px-1 text-red-700" aria-label="Supprimer la ligne" onClick={() => removeLine(i)}>×</button></>}</td>
                      </tr>
                    ))}
                    {canEdit && <tr><td className="p-1" colSpan={15}><button className="text-sm underline" onClick={() => addLine(c.code)}>+ Ajouter une ligne « {c.label} »</button></td></tr>}
                  </tbody>
                );
              })}
              <tbody>
                <tr className="bg-gray-100 font-semibold"><td className="sticky left-0 bg-gray-100 p-2">Volumes (hL)</td><td colSpan={14} /></tr>
                {(['brewed', 'sold'] as const).map((k) => (
                  <tr key={k} className="border-t">
                    <td className="sticky left-0 bg-white p-2">{k === 'brewed' ? 'Volume brassé' : 'Volume vendu'}</td>
                    {vol[k].map((a, m) => <td key={m} className="p-1"><input className={input} type="number" min={0} step="0.01" value={a || ''} disabled={ro} onChange={(e) => setVolume(k, m, e.target.value)} onFocus={(e) => e.target.select()} /></td>)}
                    <td className="p-2 text-right tabular-nums">{nf(sum(vol[k]))} hL</td><td />
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="overflow-x-auto rounded border bg-white">
            <h2 className="p-3 text-lg font-semibold">Récapitulatif {year}</h2>
            <table className="w-full text-sm">
              <thead className="bg-gray-50"><tr><th className="p-2 text-left">Synthèse</th>{MONTHS.map((m) => <th key={m} className="p-2 text-right">{m}</th>)}<th className="p-2 text-right">Total</th></tr></thead>
              <tbody>
                <tr className="border-t font-medium"><td className="p-2">Revenus prévus</td>{recap.rev.map((v, i) => <td key={i} className="p-2 text-right tabular-nums">{eur(v)}</td>)}<td className="p-2 text-right tabular-nums">{eur(totRev)}</td></tr>
                {recap.byCat.filter((c) => KIND_OF[c.code] === 'cout').map((c) => <tr key={c.code} className="border-t text-gray-700"><td className="p-2 pl-5">{c.label}</td>{c.months.map((v, i) => <td key={i} className="p-2 text-right tabular-nums">{eur(v)}</td>)}<td className="p-2 text-right tabular-nums">{eur(sum(c.months))}</td></tr>)}
                <tr className="border-t font-medium"><td className="p-2">Total des coûts</td>{recap.cost.map((v, i) => <td key={i} className="p-2 text-right tabular-nums">{eur(v)}</td>)}<td className="p-2 text-right tabular-nums">{eur(totCost)}</td></tr>
                <tr className="border-t-2 bg-yellow-50 font-semibold"><td className="p-2">Résultat prévu</td>{recap.result.map((v, i) => <td key={i} className={`p-2 text-right tabular-nums ${v < 0 ? 'text-red-700' : ''}`}>{eur(v)}</td>)}<td className={`p-2 text-right tabular-nums ${totRes < 0 ? 'text-red-700' : ''}`}>{eur(totRes)}</td></tr>
                <tr className="border-t text-gray-600"><td className="p-2">Marge sur revenus</td>{recap.result.map((v, i) => <td key={i} className="p-2 text-right">{recap.rev[i] ? pct(pctOf(v, recap.rev[i])).replace('+', '') : '—'}</td>)}<td className="p-2 text-right">{totRev ? pct(pctOf(totRes, totRev)).replace('+', '') : '—'}</td></tr>
                <tr className="border-t text-gray-600"><td className="p-2">Coût moyen par hL vendu</td><td colSpan={12} /><td className="p-2 text-right">{sum(vol.sold) ? eur(totCost / sum(vol.sold)) : '—'}</td></tr>
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
