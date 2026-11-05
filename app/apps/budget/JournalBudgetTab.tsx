'use client';
// app/apps/budget/JournalBudgetTab.tsx : onglet « Historique / Journal » des modifications budgétaires (table budget_modifications_log, sql/12)
// Lecture seule. Filtres : budget (année + scénario), auteur, compte PCMN, période, type. Chargé côté client uniquement (pas de formatage au rendu serveur).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CHART, MONTHS } from '@/lib/pcmn';

type Row = { id: number; horodatage: string; utilisateur: string | null; annee: number; scenario: string; scenario_titre: string | null; type: string; compte: string | null; mois: number | null; ancien: number | null; nouveau: number | null; ecart: number | null; libelle: string | null };
type Filtres = { budgets: { annee: number; scenario: string; titre: string | null }[]; utilisateurs: string[] };
const PAGE = 100;
const ACC: Record<string, string> = {};
CHART.forEach((s) => s.groups.forEach((g) => g.accounts.forEach((a) => { ACC[a[0]] = (a[1] || a[0]) + ' · ' + a[2]; })));
const nf2 = new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TYPES: [string, string][] = [['modification', 'Modification de montant'], ['creation', 'Création de budget'], ['validation', 'Validation / verrouillage'], ['suppression', 'Suppression de budget']];
const dh = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-BE') + ' ' + d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };

export default function JournalBudgetTab({ supabase, year, scenario }: { supabase: any; year: number; scenario: string }) {
  const [fl, setFl] = useState<Filtres>({ budgets: [], utilisateurs: [] });
  const [bud, setBud] = useState(''); const [user, setUser] = useState(''); const [type, setType] = useState(''); const [cpt, setCpt] = useState('');
  const [du, setDu] = useState(''); const [au, setAu] = useState('');
  const [rows, setRows] = useState<Row[]>([]); const [plus, setPlus] = useState(false); const [charge, setCharge] = useState(false); const [erreur, setErreur] = useState('');

  const comptes = useMemo(() => { const t = cpt.trim().toLowerCase(); return t.length < 2 ? [] : Object.keys(ACC).filter((k: string) => ACC[k].toLowerCase().includes(t)).slice(0, 40); }, [cpt]);
  const requete = useCallback((from: number) => {
    let q = supabase.from('budget_modifications_log').select('*').order('id', { ascending: false }).range(from, from + PAGE - 1);
    if (bud) { const [a, s] = bud.split('|'); q = q.eq('annee', +a).eq('scenario', s); }
    if (user) q = q.eq('utilisateur', user);
    if (type) q = q.eq('type', type);
    if (cpt.trim()) { if (comptes.length) q = q.in('compte', comptes); else q = q.ilike('compte', cpt.trim() + '%'); }
    if (du) q = q.gte('horodatage', new Date(du + 'T00:00:00').toISOString());
    if (au) q = q.lte('horodatage', new Date(au + 'T23:59:59').toISOString());
    return q;
  }, [supabase, bud, user, type, cpt, comptes, du, au]);
  const charger = useCallback(async (suite: boolean) => {
    setCharge(true); const r: any = await requete(suite ? rows.length : 0); setCharge(false);
    if (r.error) { const m: string = r.error.message || ''; setErreur(/budget_modifications_log|schema cache|does not exist/i.test(m) ? 'Le journal n’existe pas encore : exécutez sql/12_budget_audit_verrous_invest.sql dans Supabase, puis rechargez la page.' : 'Lecture du journal impossible : ' + m); if (!suite) setRows([]); return; }
    setErreur(''); const d: Row[] = (r.data || []).map((x: any): Row => ({ ...x, ancien: x.ancien == null ? null : Number(x.ancien), nouveau: x.nouveau == null ? null : Number(x.nouveau), ecart: x.ecart == null ? null : Number(x.ecart) }));
    setRows((p: Row[]) => (suite ? p.concat(d) : d)); setPlus(d.length === PAGE);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requete, rows.length]);
  useEffect(() => { charger(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [bud, user, type, du, au, cpt]);
  useEffect(() => { supabase.rpc('budget_journal_filtres').then((r: any) => { if (!r.error && r.data && r.data.budgets) setFl(r.data as Filtres); }); }, [supabase]);

  const reinit = () => { setBud(''); setUser(''); setType(''); setCpt(''); setDu(''); setAu(''); };
  return (
    <div className="bt-root">
      <section className="bd-bar" aria-label="Filtres du journal">
        <label className="bd-lbl" htmlFor="jb-bud">Budget</label>
        <select id="jb-bud" value={bud} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setBud(e.target.value)}>
          <option value="">Tous les budgets</option>
          {fl.budgets.map((b) => <option key={b.annee + '|' + b.scenario} value={b.annee + '|' + b.scenario}>{b.annee} · {b.titre || b.scenario}</option>)}
        </select>
        <button type="button" className="bd-btn sm" onClick={() => setBud(year + '|' + scenario)} title="Filtrer sur le budget actuellement ouvert">Budget ouvert</button>
        <label className="bd-lbl" htmlFor="jb-usr">Personne</label>
        <select id="jb-usr" value={user} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setUser(e.target.value)}><option value="">Toutes</option>{fl.utilisateurs.map((u: string) => <option key={u} value={u}>{u}</option>)}</select>
        <label className="bd-lbl" htmlFor="jb-typ">Type</label>
        <select id="jb-typ" value={type} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setType(e.target.value)}><option value="">Tous</option>{TYPES.map((t: [string, string]) => <option key={t[0]} value={t[0]}>{t[1]}</option>)}</select>
        <label className="bd-lbl" htmlFor="jb-cpt">Compte PCMN</label>
        <input id="jb-cpt" className="bd-in wide" type="search" placeholder="Code ou libellé (ex. 6130, loyers)" value={cpt} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCpt(e.target.value)} />
        <label className="bd-lbl" htmlFor="jb-du">Du</label><input id="jb-du" className="bd-in w70" style={{ width: 140, textAlign: 'left' }} type="date" value={du} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDu(e.target.value)} />
        <label className="bd-lbl" htmlFor="jb-au">au</label><input id="jb-au" className="bd-in w70" style={{ width: 140, textAlign: 'left' }} type="date" value={au} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAu(e.target.value)} />
        <button type="button" className="bd-btn" onClick={reinit}>Réinitialiser</button>
        <button type="button" className="bd-btn" onClick={() => charger(false)}>↻ Actualiser</button>
        <span className="bd-hint">{rows.length} ligne{rows.length > 1 ? 's' : ''}{plus ? ' (il y en a d’autres)' : ''}</span>
      </section>
      {erreur ? <div className="bd-alert" role="alert">{erreur}</div> : null}
      <div className="bt-wrap" role="region" aria-label="Journal des modifications budgétaires" tabIndex={0}>
        <table className="bd-tbl bt-tbl">
          <thead><tr><th className="bt-l">Date / heure</th><th>Budget</th><th>Compte PCMN</th><th>Mois</th><th className="n">Ancien montant</th><th className="n">Nouveau montant</th><th className="n">Écart (€)</th><th>Auteur</th></tr></thead>
          <tbody>
            {rows.map((j: Row) => (
              <tr key={j.id}>
                <th className="bt-l" scope="row">{dh(j.horodatage)}</th>
                <td>{j.annee} · {j.scenario_titre || j.scenario}</td>
                {j.compte ? <>
                  <td>{ACC[j.compte] || j.compte}{j.libelle ? <small>{j.libelle}</small> : null}</td>
                  <td>{j.mois ? MONTHS[j.mois - 1] : 'Année entière'}</td>
                  <td className="n">{j.ancien == null ? '—' : nf2.format(j.ancien)}</td><td className="n">{j.nouveau == null ? '—' : nf2.format(j.nouveau)}</td>
                  <td className={'n' + ((j.ecart || 0) < 0 ? ' neg' : '')}>{j.ecart == null ? '—' : (j.ecart > 0 ? '+' : '') + nf2.format(j.ecart)}</td>
                </> : <td colSpan={5}><span className="bd-badge" style={{ margin: 0 }}>{(TYPES.find((t: [string, string]) => t[0] === j.type) || [j.type, j.type])[1]}</span> {j.libelle || ''}</td>}
                <td>{j.utilisateur || '—'}</td>
              </tr>))}
            {!charge && !erreur && rows.length === 0 ? <tr><td colSpan={8} className="bd-hint" style={{ padding: 14 }}>Aucune modification enregistrée pour ces filtres.</td></tr> : null}
            {charge ? <tr><td colSpan={8} className="bd-hint" style={{ padding: 14 }} role="status">Chargement…</td></tr> : null}
          </tbody>
        </table>
      </div>
      {plus && !charge ? <div><button type="button" className="bd-btn" onClick={() => charger(true)}>Charger les {PAGE} lignes suivantes</button></div> : null}
      <p className="bd-hint">Une ligne par compte et par mois modifié (les modifications en masse — variation en %, reprise d’une année — sont regroupées par compte). Le journal est en lecture seule et alimenté par la base à chaque enregistrement ; la saisie est enregistrée automatiquement quelques secondes après la dernière frappe.</p>
    </div>
  );
}
