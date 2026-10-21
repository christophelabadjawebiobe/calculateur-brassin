'use client';
// app/apps/analyse/ActualsEntry.tsx : saisie des chiffres réels d'un mois
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CATEGORIES, CategoryCode, MONTHS_LONG, num } from '@/lib/finance';

type Line = { category: CategoryCode; label: string; amount: number };
const keyOf = (l: Pick<Line, 'category' | 'label'>) => `${l.category}|${l.label.trim()}`;

export default function ActualsEntry({ year, defaultMonth }: { year: number; defaultMonth: number }) {
  const supabase = useMemo(() => createClient(), []);
  const [month, setMonth] = useState(defaultMonth);
  const [lines, setLines] = useState<Line[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [brewed, setBrewed] = useState(0);
  const [sold, setSold] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setMsg(null);
    const [a, v] = await Promise.all([
      supabase.from('actuals_monthly').select('category,label,amount').eq('year', year).eq('month', month),
      supabase.from('actual_volumes').select('hl_brewed,hl_sold').eq('year', year).eq('month', month).maybeSingle(),
    ]);
    if (a.error) { setMsg({ ok: false, text: a.error.message }); return; }
    const ls = (a.data ?? []).map((r) => ({ category: r.category as CategoryCode, label: r.label as string, amount: num(r.amount) }));
    // une ligne vide par catégorie pour démarrer rapidement
    CATEGORIES.forEach((c) => { if (!ls.some((l) => l.category === c.code)) ls.push({ category: c.code, label: '', amount: 0 }); });
    setLines(ls); setSaved((a.data ?? []).map((r) => keyOf(r as Line)));
    setBrewed(num(v.data?.hl_brewed)); setSold(num(v.data?.hl_sold));
  }, [supabase, year, month]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    const cleaned = lines.map((l) => ({ ...l, label: l.label.trim() })).filter((l) => l.amount > 0 || saved.includes(keyOf(l)));
    const keys = cleaned.map(keyOf);
    if (new Set(keys).size !== keys.length) { setMsg({ ok: false, text: 'Deux lignes ont la même catégorie et le même libellé.' }); return; }
    setBusy(true); setMsg(null);
    try {
      for (const k of saved.filter((k) => !keys.includes(k))) {
        const [category, ...rest] = k.split('|');
        const { error } = await supabase.from('actuals_monthly').delete().eq('year', year).eq('month', month).eq('category', category).eq('label', rest.join('|'));
        if (error) throw error;
      }
      if (cleaned.length) {
        const { error } = await supabase.from('actuals_monthly').upsert(cleaned.map((l) => ({ year, month, category: l.category, label: l.label, amount: l.amount })), { onConflict: 'year,month,category,label' });
        if (error) throw error;
      }
      const { error: ve } = await supabase.from('actual_volumes').upsert({ year, month, hl_brewed: brewed, hl_sold: sold }, { onConflict: 'year,month' });
      if (ve) throw ve;
      setSaved(keys); setMsg({ ok: true, text: `${MONTHS_LONG[month - 1]} ${year} enregistré.` });
    } catch (e) { setMsg({ ok: false, text: `Enregistrement impossible : ${(e as Error).message}` }); }
    finally { setBusy(false); }
  };

  return (
    <section className="space-y-3 rounded border bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="text-lg font-semibold">Chiffres réels de {year}</h2>
        <label className="text-sm">Mois <select className="ml-2 rounded border px-2 py-1" value={month} onChange={(e) => setMonth(+e.target.value)}>{MONTHS_LONG.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <button className="rounded bg-yellow-500 px-3 py-1.5 font-medium text-black disabled:opacity-50" onClick={save} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</span>}
      </div>
      <table className="w-full max-w-3xl text-sm">
        <thead><tr className="text-left"><th className="p-1">Catégorie</th><th className="p-1">Libellé</th><th className="p-1 text-right">Montant € HTVA</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-t">
              <td className="p-1"><select className="rounded border px-1 py-0.5" value={l.category} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, category: e.target.value as CategoryCode } : x))}>{CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select></td>
              <td className="p-1"><input className="w-full rounded border px-1 py-0.5" value={l.label} placeholder="optionnel" onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} /></td>
              <td className="p-1"><input className="w-32 rounded border px-1 py-0.5 text-right tabular-nums" type="number" min={0} step="0.01" value={l.amount || ''} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, amount: Math.max(0, num(e.target.value)) } : x))} /></td>
              <td className="p-1"><button className="px-1 text-red-700" aria-label="Supprimer la ligne" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>×</button></td>
            </tr>))}
        </tbody>
      </table>
      <button className="text-sm underline" onClick={() => setLines((ls) => [...ls, { category: 'ventes', label: '', amount: 0 }])}>+ Ajouter une ligne</button>
      <div className="flex flex-wrap gap-4 text-sm">
        <label>Volume brassé (hL) <input className="ml-2 w-24 rounded border px-1 py-0.5 text-right" type="number" min={0} step="0.01" value={brewed || ''} onChange={(e) => setBrewed(Math.max(0, num(e.target.value)))} /></label>
        <label>Volume vendu (hL) <input className="ml-2 w-24 rounded border px-1 py-0.5 text-right" type="number" min={0} step="0.01" value={sold || ''} onChange={(e) => setSold(Math.max(0, num(e.target.value)))} /></label>
      </div>
    </section>
  );
}
