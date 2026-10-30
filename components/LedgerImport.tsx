'use client';
// components/LedgerImport.tsx : import d'un export comptable (Odoo, Excel ou CSV) -> réalisé par compte et par mois.
// Utilisé par le Budget (« Importer une année ») et par l'Analyse (« Importer le réalisé »).
// Écrit dans pcmn_actuals (mensuel) et pcmn_budget_history (total annuel par compte, repris par le Budget).
import React, { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ACC_SEC, CHART, MONTHS, Z12, addTo, eur0, fmt0, results, sum, r2 } from '@/lib/pcmn';
import { parseLedger, readTable, type Parsed, type Raw } from '@/lib/tabular';

type Orient = 'auto' | 'balance' | 'natural';
const chunk = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

/** Totaux par section d'un jeu de comptes (12 mois) -> CA et résultat net, pour contrôler l'import avant de l'enregistrer */
export function summarize(accts: Record<string, number[]>) {
  const S: Record<string, number[]> = {};
  CHART.forEach((s) => { S[s.k] = Z12(); });
  Object.entries(accts).forEach(([k, m]) => { const s = ACC_SEC[k]; if (s) addTo(S[s.k], m); });
  const res = results(S, 12);
  return { ca: S.s70, net: res.net, cost: sum(S.s60) + sum(S.s61) + sum(S.s62) };
}

export const LI_CSS = `
.li-box{border:1px solid var(--line);border-radius:6px;background:var(--surface);padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.li-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.li-row label{font-size:12px;color:var(--muted);font-weight:600}
.li-row select,.li-row input[type=number]{height:32px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);padding:0 8px;font:inherit;font-size:13px}
.li-row input[type=number]{width:88px}
.li-btn{appearance:none;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:4px;height:32px;padding:0 12px;cursor:pointer;font:inherit;font-size:13px;white-space:nowrap}
.li-btn:hover:not(:disabled){border-color:var(--muted)}
.li-btn.primary{background:var(--brand-2);border-color:var(--brand-2);color:var(--brand);font-weight:600}
.li-btn:disabled{opacity:.55;cursor:not-allowed}
.li-msg{font-size:13px;padding:8px 10px;border-radius:4px}
.li-msg.err{background:var(--bad-soft);color:var(--bad)} .li-msg.ok{background:var(--good-soft);color:var(--good)} .li-msg.info{background:var(--surface-2);color:var(--muted)}
.li-tbl{border-collapse:collapse;font-size:12px;width:100%}
.li-tbl th,.li-tbl td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:right;white-space:nowrap}
.li-tbl th:first-child,.li-tbl td:first-child{text-align:left}
.li-tbl td.mono{font-family:var(--font-mono,monospace);font-variant-numeric:tabular-nums}
.li-scroll{overflow:auto;max-width:100%}
.li-small{font-size:12px;color:var(--muted)}
.li-un{max-height:96px;overflow:auto;font-family:var(--font-mono,monospace);font-size:11.5px;color:var(--muted)}
`;

export default function LedgerImport({ defaultYear, canWrite, onImported }: { defaultYear: number; canWrite: boolean; onImported: (years: number[]) => void }) {
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [orient, setOrient] = useState<Orient>('auto');
  const [year, setYear] = useState(defaultYear);
  const [sel, setSel] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const raw = useRef<Raw | null>(null);

  const run = (r: Raw, o: Orient, y: number) => {
    try {
      const p = parseLedger(r, { defaultYear: y, orientation: o });
      setParsed(p); setErr('');
      const s: Record<number, boolean> = {}; (p.layout === 'annual' ? [y] : p.years).forEach((yy) => { s[yy] = true; }); setSel(s);
    } catch (e: any) { setParsed(null); setErr(e && e.message ? e.message : 'Fichier illisible'); }
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setOk(''); setFileName(f.name); setBusy(true);
    try { raw.current = await readTable(f); run(raw.current, orient, year); }
    catch (e: any) { setParsed(null); setErr(e && e.message ? e.message : 'Fichier illisible'); }
    setBusy(false);
  };

  // montants 12 mois par année (layout annual : tout dans la 1re colonne de l'année choisie, pour l'aperçu)
  const dataByYear = (): Record<number, Record<string, number[]>> => {
    if (!parsed) return {};
    if (parsed.layout !== 'annual') return parsed.byYear;
    const o: Record<string, number[]> = {};
    Object.entries(parsed.annual).forEach(([k, v]) => { o[k] = Z12().map((_, i) => (i === 0 ? v : 0)); });
    return { [year]: o };
  };

  const doImport = async () => {
    if (!parsed) return;
    const years = Object.keys(sel).map(Number).filter((y) => sel[y]);
    if (!years.length) return;
    if (!confirm(`Remplacer les chiffres déjà enregistrés pour ${years.join(', ')} par ceux de « ${fileName} » ?`)) return;
    setBusy(true); setErr(''); setOk('');
    const supabase = createClient();
    try {
      const data = dataByYear();
      for (const y of years) {
        const accts = data[y] || {};
        const hist = Object.entries(accts).map(([k, m]) => ({ account_key: k, year: y, amount: r2(sum(m)) })).filter((r) => Math.abs(r.amount) >= 0.005);
        const del1 = await supabase.from('pcmn_budget_history').delete().eq('year', y); if (del1.error) throw del1.error;
        for (const c of chunk(hist, 400)) { const r = await supabase.from('pcmn_budget_history').upsert(c, { onConflict: 'account_key,year' }); if (r.error) throw r.error; }
        if (parsed.layout !== 'annual') {
          const rows: { account_key: string; year: number; month: number; amount: number; source: string }[] = [];
          Object.entries(accts).forEach(([k, m]) => m.forEach((v, i) => { if (Math.abs(v) >= 0.005) rows.push({ account_key: k, year: y, month: i + 1, amount: v, source: fileName.slice(0, 80) }); }));
          const del2 = await supabase.from('pcmn_actuals').delete().eq('year', y); if (del2.error) throw del2.error;
          for (const c of chunk(rows, 500)) { const r = await supabase.from('pcmn_actuals').upsert(c, { onConflict: 'account_key,year,month' }); if (r.error) throw r.error; }
        }
      }
      setOk(`Import terminé : ${years.join(', ')}.` + (parsed.layout === 'annual' ? ' Fichier annuel : pas de détail mensuel (l’analyse mensuelle nécessite un export par mois).' : ''));
      onImported(years);
    } catch (e: any) {
      const m = (e && e.message) || 'erreur';
      setErr(/relation|does not exist|schema cache/i.test(m) ? 'Tables absentes : exécutez sql/04_admin_reel_validation.sql dans Supabase, puis réessayez.' : /row-level security|permission/i.test(m) ? 'Droits insuffisants : seuls les rôles admin et brasseur peuvent importer.' : 'Import impossible : ' + m);
    }
    setBusy(false);
  };

  const data = dataByYear();
  const yearsShown = parsed ? (parsed.layout === 'annual' ? [year] : parsed.years) : [];
  return (
    <div className="li-box">
      <style dangerouslySetInnerHTML={{ __html: LI_CSS }} />
      <div className="li-row">
        <input id="li-file" type="file" accept=".xlsx,.csv,.txt,.tsv" aria-label="Fichier d'export Odoo, Excel ou CSV" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} disabled={!canWrite || busy} />
        {fileName ? <span className="li-small">{fileName}</span> : null}
      </div>
      <p className="li-small" style={{ margin: 0 }}>
        Formats reconnus : (1) grand livre / balance Odoo avec colonnes <b>Date</b>, <b>Compte</b>, <b>Débit</b>, <b>Crédit</b> (ou <b>Balance</b>) ; (2) tableau croisé avec <b>un compte par ligne et 12 colonnes de mois</b> ; (3) balance annuelle (Compte + Débit/Crédit ou Solde). Les comptes sont rapprochés du plan comptable du budget par leur code à 6 chiffres.
      </p>
      {parsed ? (
        <>
          <div className="li-row">
            <label htmlFor="li-or">Sens des montants</label>
            <select id="li-or" value={orient} onChange={(e) => { const o = e.target.value as Orient; setOrient(o); if (raw.current) run(raw.current, o, year); }}>
              <option value="auto">Détection automatique ({parsed.orientation === 'balance' ? 'soldes débit − crédit' : 'montants positifs'})</option>
              <option value="balance">Soldes comptables (débit − crédit)</option>
              <option value="natural">Montants déjà positifs (produits et charges)</option>
            </select>
            {parsed.layout !== 'long' ? (
              <>
                <label htmlFor="li-y">Année du fichier</label>
                <input id="li-y" type="number" min={2000} max={2100} value={year} onChange={(e) => { const y = +e.target.value || defaultYear; setYear(y); if (raw.current && y >= 2000) run(raw.current, orient, y); }} />
              </>
            ) : null}
          </div>
          <div className="li-small">{parsed.rows} lignes lues · {parsed.matched} comptes reconnus · {parsed.unmatched.length} codes hors plan{parsed.notes.length ? ' · ' + parsed.notes.join(' · ') : ''}</div>
          <div className="li-scroll">
            <table className="li-tbl">
              <thead><tr><th>Année</th><th>CA (70)</th><th>Résultat net</th>{MONTHS.map((m) => <th key={m}>{m}</th>)}<th /></tr></thead>
              <tbody>
                {yearsShown.map((y) => { const s = summarize(data[y] || {}); return (
                  <tr key={y}>
                    <td><b>{y}</b></td><td className="mono">{eur0(sum(s.ca))}</td><td className="mono">{eur0(sum(s.net))}</td>
                    {s.ca.map((v, i) => <td key={i} className="mono">{parsed.layout === 'annual' ? '' : fmt0(v)}</td>)}
                    <td><label><input type="checkbox" checked={!!sel[y]} onChange={(e) => setSel((o) => ({ ...o, [y]: e.target.checked }))} /> importer</label></td>
                  </tr>); })}
                {!yearsShown.length ? <tr><td colSpan={16}>Aucune donnée exploitable.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {parsed.unmatched.length ? (
            <details><summary className="li-small">Codes non repris ({parsed.unmatched.length}) : comptes absents du plan comptable du budget</summary>
              <div className="li-un">{parsed.unmatched.slice(0, 60).map((u) => <div key={u.code}>{u.code} : {fmt0(u.amount)}</div>)}</div></details>
          ) : null}
          <div className="li-row">
            <button type="button" className="li-btn primary" disabled={!canWrite || busy || !Object.values(sel).some(Boolean)} onClick={doImport}>{busy ? 'Import…' : 'Enregistrer l’import'}</button>
            {!canWrite ? <span className="li-small">Votre rôle ne permet pas d’importer.</span> : null}
          </div>
        </>
      ) : null}
      {err ? <div className="li-msg err" role="alert">{err}</div> : null}
      {ok ? <div className="li-msg ok" role="status">{ok}</div> : null}
    </div>
  );
}
