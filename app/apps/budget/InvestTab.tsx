'use client';
// app/apps/budget/InvestTab.tsx : onglet « Investissements, Emprunts & Amortissements »
//   A. amortissements existants (dotations par exercice)  B. simulateur de nouveaux investissements  C. emprunts et dettes financières
//   + injection des dotations (63x) et des intérêts (65x) dans le budget de l'année. Données : budget_immobilisations, budget_emprunts (sql/12).
//   Hydratation : le composant n'est monté qu'après le chargement côté client du budget ; aucun format local au rendu serveur.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CHART, accMonths, fmt0, parseNum, secAccKeys, sum, type Plan } from '@/lib/pcmn';
import {
  annuite, dotationAnnee, dotationsParCompte, echeancier, empruntAnnee, interetsParCompte, moisAbsolu, moisPremiereAnnee, nbMoisAmort, vncFin,
  type Emprunt, type Immo,
} from '@/lib/invest';

type Inject = { key: string; months: number[] }[];
type Props = { supabase: any; year: number; canWrite: boolean; ro: boolean; plan: Plan | null; onInject: (u: Inject, label: string) => void };

const ACC_LABEL: Record<string, string> = {};
CHART.forEach((s) => s.groups.forEach((g) => g.accounts.forEach((a) => { ACC_LABEL[a[0]] = a[1] ? a[1] + ' · ' + a[2] : a[2]; })));
const KEYS_63 = secAccKeys(CHART.find((s) => s.k === 's630')!);
const KEYS_65 = secAccKeys(CHART.find((s) => s.k === 's65')!);
const nf2 = new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur2 = (n: number) => nf2.format(n) + ' €';
const ym = (iso: string) => (iso || '').slice(0, 7);
const addMonths = (ymStr: string, n: number): string => { const a = moisAbsolu(ymStr + '-01'); if (!Number.isFinite(a)) return ''; const t = a + n; return String(Math.floor(t / 12)).padStart(4, '0') + '-' + String((t % 12) + 1).padStart(2, '0'); };
const errTxt = (e: any): string => { const m: string = (e && e.message) || ''; return /relation|does not exist|schema cache/i.test(m) ? 'Les tables n’existent pas encore : exécutez sql/12_budget_audit_verrous_invest.sql dans Supabase, puis rechargez la page.' : m; };

export default function InvestTab({ supabase, year, canWrite, ro, plan, onInject }: Props) {
  const [immos, setImmos] = useState<Immo[]>([]); const [emps, setEmps] = useState<Emprunt[]>([]);
  const [notice, setNotice] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false);
  const [deb, setDeb] = useState(year);
  useEffect(() => { setDeb(year); }, [year]);
  const ys = useMemo(() => [0, 1, 2, 3, 4, 5].map((i: number) => deb + i), [deb]);

  const charger = useCallback(async () => {
    const [a, b] = await Promise.all([supabase.from('budget_immobilisations').select('*').order('date_service'), supabase.from('budget_emprunts').select('*').order('date_premiere_echeance')]);
    const err = a.error || b.error;
    if (err) { setNotice(errTxt(err)); setReady(true); return; }
    setNotice('');
    setImmos((a.data || []).map((r: any): Immo => ({ id: r.id, libelle: r.libelle, date_service: r.date_service, duree_annees: Number(r.duree_annees), montant_htva: Number(r.montant_htva), methode: 'lineaire', statut: r.statut, inclus: !!r.inclus, compte: r.compte, commentaire: r.commentaire })));
    setEmps((b.data || []).map((r: any): Emprunt => ({ id: r.id, organisme: r.organisme, capital: Number(r.capital), mensualite: Number(r.mensualite), date_premiere_echeance: r.date_premiere_echeance, date_fin: r.date_fin, compte_interets: r.compte_interets, commentaire: r.commentaire })));
    setReady(true);
  }, [supabase]);
  useEffect(() => { charger(); }, [charger]);

  /* ---------------- formulaire d'immobilisation ---------------- */
  const vide = { id: '', libelle: '', mois: String(year) + '-01', duree: '5', montant: '', statut: 'simulation' as 'existant' | 'simulation', compte: '630200' };
  const [f, setF] = useState(vide);
  const fImmo: Immo = { id: f.id, libelle: f.libelle, date_service: f.mois + '-01', duree_annees: parseNum(f.duree), montant_htva: parseNum(f.montant), methode: 'lineaire', statut: f.statut, inclus: true, compte: f.compte };
  const fOk = f.libelle.trim() !== '' && fImmo.duree_annees > 0 && fImmo.duree_annees <= 60 && fImmo.montant_htva > 0 && Number.isFinite(moisAbsolu(fImmo.date_service));
  const sauverImmo = async () => {
    if (!fOk) return; setBusy(true); setMsg('');
    const row = { libelle: f.libelle.trim(), date_service: fImmo.date_service, duree_annees: fImmo.duree_annees, montant_htva: fImmo.montant_htva, methode: 'lineaire', statut: f.statut, compte: f.compte };
    const r = f.id ? await supabase.from('budget_immobilisations').update(row).eq('id', f.id) : await supabase.from('budget_immobilisations').insert(row);
    setBusy(false);
    if (r.error) { setMsg(errTxt(r.error)); return; }
    setF({ ...vide, statut: f.statut, mois: f.mois }); await charger();
  };
  const [sup, setSup] = useState('');
  const supprimer = async (table: string, id: string) => {
    if (sup !== id) { setSup(id); return; }
    setBusy(true); const r = await supabase.from(table).delete().eq('id', id); setBusy(false); setSup('');
    if (r.error) setMsg(errTxt(r.error)); else await charger();
  };
  const basculer = async (i: Immo) => { const r = await supabase.from('budget_immobilisations').update({ inclus: !i.inclus }).eq('id', i.id); if (r.error) setMsg(errTxt(r.error)); else await charger(); };

  /* ---------------- formulaire d'emprunt ---------------- */
  const videE = { id: '', organisme: '', capital: '', mensualite: '', debut: String(year) + '-01', fin: String(year + 5) + '-01', compte: '650000' };
  const [e, setE] = useState(videE);
  const eEmp: Emprunt = { id: e.id, organisme: e.organisme, capital: parseNum(e.capital), mensualite: parseNum(e.mensualite), date_premiere_echeance: e.debut + '-01', date_fin: e.fin + '-01', compte_interets: e.compte };
  const eCalc = echeancier(eEmp);
  const eOk = e.organisme.trim() !== '' && eEmp.capital > 0 && eEmp.mensualite > 0 && eCalc.n > 0;
  const eInt = eCalc.mois.reduce((a: number, x) => a + x.interets, 0);
  const sauverEmp = async () => {
    if (!eOk) return; setBusy(true); setMsg('');
    const row = { organisme: e.organisme.trim(), capital: eEmp.capital, mensualite: eEmp.mensualite, date_premiere_echeance: eEmp.date_premiere_echeance, date_fin: eEmp.date_fin, compte_interets: e.compte };
    const r = e.id ? await supabase.from('budget_emprunts').update(row).eq('id', e.id) : await supabase.from('budget_emprunts').insert(row);
    setBusy(false);
    if (r.error) { setMsg(errTxt(r.error)); return; }
    setE(videE); await charger();
  };

  /* ---------------- calculs d'affichage ---------------- */
  const existants = immos.filter((i: Immo) => i.statut === 'existant'), simules = immos.filter((i: Immo) => i.statut === 'simulation');
  const totalAn = (l: Immo[], y: number, seulInclus: boolean) => l.filter((i: Immo) => !seulInclus || i.inclus).reduce((a: number, i: Immo) => a + dotationAnnee(i, y), 0);
  const calc = useMemo(() => emps.map((x: Emprunt) => { const c = echeancier(x); return { x, c, a: ys.map((y: number) => empruntAnnee(x, c, y)) }; }), [emps, ys]);

  const dot = useMemo(() => dotationsParCompte(immos, year), [immos, year]);
  const int = useMemo(() => interetsParCompte(emps, year), [emps, year]);
  const actuel = (k: string) => (plan && plan.rows[k] ? sum(accMonths(plan.rows[k])) : 0);
  const lignesInj = (m: Record<string, number[]>) => Object.keys(m).map((k: string) => ({ key: k, months: m[k], nouveau: sum(m[k]), ancien: actuel(k) }));
  const injD = lignesInj(dot), injI = lignesInj(int);
  const noteInj = (l: { key: string }[]) => (l.length ? '' : 'Rien à injecter pour ' + year + '.');

  const ImmoTable = ({ liste, titre, vide: pasDe }: { liste: Immo[]; titre: string; vide: string }) => (
    <div className="bt-wrap" role="region" aria-label={titre} tabIndex={0}>
      <table className="bd-tbl bt-tbl">
        <thead><tr><th className="bt-l">Immobilisation</th><th>Mise en service</th><th className="n">Durée</th><th className="n">Montant HTVA</th><th className="n">Annuité</th>{ys.map((y: number) => <th key={y} className="n">{y}</th>)}<th className="n">VNC {deb + 5}</th><th /></tr></thead>
        <tbody>
          {liste.map((i: Immo) => (
            <tr key={i.id} className={i.inclus ? '' : 'bt-off'}>
              <th className="bt-l" scope="row">{i.libelle}<small>{ACC_LABEL[i.compte] || i.compte}</small></th>
              <td>{ym(i.date_service)}</td><td className="n">{i.duree_annees} an{i.duree_annees > 1 ? 's' : ''}</td><td className="n">{fmt0(i.montant_htva)}</td><td className="n">{fmt0(annuite(i))}</td>
              {ys.map((y: number) => <td key={y} className="n">{fmt0(i.inclus ? dotationAnnee(i, y) : 0)}</td>)}
              <td className="n dim">{fmt0(vncFin(i, deb + 5))}</td>
              <td className="bt-act">
                {i.statut === 'simulation' ? <label className="bt-chk" title="Inclure dans l’injection au budget"><input type="checkbox" checked={i.inclus} disabled={!canWrite} onChange={() => basculer(i)} />inclus</label> : null}
                <button type="button" className="bd-btn sm" disabled={!canWrite} onClick={() => { setF({ id: i.id, libelle: i.libelle, mois: ym(i.date_service), duree: String(i.duree_annees), montant: String(i.montant_htva), statut: i.statut, compte: i.compte }); }}>Modifier</button>
                <button type="button" className="bd-btn sm danger" disabled={!canWrite || busy} onClick={() => supprimer('budget_immobilisations', i.id)}>{sup === i.id ? 'Confirmer ?' : 'Supprimer'}</button>
              </td>
            </tr>))}
          {liste.length === 0 ? <tr><td colSpan={ys.length + 7} className="bd-hint" style={{ padding: 12 }}>{pasDe}</td></tr> : null}
          {liste.length ? <tr className="bt-tot"><th className="bt-l" scope="row">Total des dotations</th><td /><td /><td className="n">{fmt0(liste.reduce((a: number, i: Immo) => a + i.montant_htva, 0))}</td><td />{ys.map((y: number) => <td key={y} className="n">{fmt0(totalAn(liste, y, true))}</td>)}<td /><td /></tr> : null}
        </tbody>
      </table>
    </div>
  );

  if (!ready) return <p className="bd-loading" role="status">Chargement…</p>;
  const pm = moisPremiereAnnee(fImmo);
  return (
    <div className="bt-root">
      {notice ? <div className="bd-alert" role="alert">{notice}</div> : null}
      {msg ? <div className="bd-alert" role="alert">{msg}</div> : null}
      <section className="bd-bar" aria-label="Exercices affichés">
        <label className="bd-lbl" htmlFor="bt-deb">Premier exercice affiché</label>
        <select id="bt-deb" value={deb} onChange={(ev: React.ChangeEvent<HTMLSelectElement>) => setDeb(+ev.target.value)}>{[year - 3, year - 2, year - 1, year, year + 1, year + 2].map((y: number) => <option key={y} value={y}>{y}</option>)}</select>
        <span className="bd-hint">Montants en € HTVA. Amortissement linéaire, prorata temporis au mois (le mois de mise en service compte en entier).</span>
      </section>

      <h2 className="bt-h">A. Amortissements existants</h2>
      {ImmoTable({ liste: existants, titre: "Amortissements existants", vide: "Aucune immobilisation existante : ajoutez-en avec le formulaire ci-dessous (statut « Existant »)." })}

      <h2 className="bt-h">B. Simulateur de nouveaux investissements</h2>
      <form className="bt-form" onSubmit={(ev: React.FormEvent) => { ev.preventDefault(); sauverImmo(); }} aria-label="Ajouter une immobilisation">
        <label className="bt-f">Libellé<input type="text" value={f.libelle} maxLength={120} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, libelle: ev.target.value })} placeholder="Ex. Nouvelle cuve de fermentation" disabled={!canWrite} /></label>
        <label className="bt-f">Mise en service (mois / année)<input type="month" value={f.mois} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, mois: ev.target.value })} disabled={!canWrite} /></label>
        <label className="bt-f">Durée d’amortissement (années)<input type="text" inputMode="decimal" value={f.duree} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, duree: ev.target.value })} disabled={!canWrite} /></label>
        <label className="bt-f">Montant HTVA (€)<input type="text" inputMode="decimal" value={f.montant} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, montant: ev.target.value })} disabled={!canWrite} /></label>
        <label className="bt-f">Méthode<select value="lineaire" disabled aria-label="Méthode d’amortissement"><option value="lineaire">Linéaire</option></select></label>
        <label className="bt-f">Statut<select value={f.statut} onChange={(ev: React.ChangeEvent<HTMLSelectElement>) => setF({ ...f, statut: ev.target.value as 'existant' | 'simulation' })} disabled={!canWrite}><option value="simulation">Nouvel investissement (simulation)</option><option value="existant">Immobilisation existante</option></select></label>
        <label className="bt-f">Compte de dotation<select value={f.compte} onChange={(ev: React.ChangeEvent<HTMLSelectElement>) => setF({ ...f, compte: ev.target.value })} disabled={!canWrite}>{KEYS_63.map((k: string) => <option key={k} value={k}>{ACC_LABEL[k]}</option>)}</select></label>
        <div className="bt-calc" aria-live="polite">
          {fOk ? <>Annuité <b>{eur2(annuite(fImmo))}</b> · mensualité <b>{eur2(fImmo.montant_htva / nbMoisAmort(fImmo))}</b> · 1<sup>re</sup> année : {pm} mois = <b>{eur2((fImmo.montant_htva / nbMoisAmort(fImmo)) * pm)}</b> · fin d’amortissement {addMonths(f.mois, nbMoisAmort(fImmo) - 1)}</> : <span className="bd-hint">Renseignez libellé, date, durée et montant pour voir l’annuité et le prorata.</span>}
        </div>
        <div className="bt-btns">
          <button type="submit" className="bd-btn primary" disabled={!canWrite || busy || !fOk}>{f.id ? 'Enregistrer les modifications' : '+ Ajouter'}</button>
          {f.id ? <button type="button" className="bd-btn" onClick={() => setF(vide)}>Annuler la modification</button> : null}
        </div>
      </form>
      {ImmoTable({ liste: simules, titre: "Nouveaux investissements simulés", vide: "Aucun investissement simulé." })}
      <div className="bt-wrap"><table className="bd-tbl bt-tbl"><thead><tr><th className="bt-l">Dotations totales (existantes + simulées incluses)</th>{ys.map((y: number) => <th key={y} className="n">{y}</th>)}</tr></thead>
        <tbody><tr className="bt-tot"><th className="bt-l" scope="row">Total à injecter au compte 63x</th>{ys.map((y: number) => <td key={y} className="n">{fmt0(totalAn(immos, y, true))}</td>)}</tr></tbody></table></div>

      <h2 className="bt-h">C. Emprunts bancaires &amp; dettes financières</h2>
      <form className="bt-form" onSubmit={(ev: React.FormEvent) => { ev.preventDefault(); sauverEmp(); }} aria-label="Ajouter un emprunt">
        <label className="bt-f">Organisme / nom<input type="text" value={e.organisme} maxLength={120} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setE({ ...e, organisme: ev.target.value })} placeholder="Ex. Credal" disabled={!canWrite} /></label>
        <label className="bt-f">Capital emprunté (€)<input type="text" inputMode="decimal" value={e.capital} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setE({ ...e, capital: ev.target.value })} disabled={!canWrite} /></label>
        <label className="bt-f">Mensualité (principal + intérêts, €)<input type="text" inputMode="decimal" value={e.mensualite} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setE({ ...e, mensualite: ev.target.value })} disabled={!canWrite} /></label>
        <label className="bt-f">Première échéance<input type="month" value={e.debut} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setE({ ...e, debut: ev.target.value })} disabled={!canWrite} /></label>
        <label className="bt-f">Dernière échéance (fin)<input type="month" value={e.fin} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setE({ ...e, fin: ev.target.value })} disabled={!canWrite} /></label>
        <label className="bt-f">Compte des intérêts<select value={e.compte} onChange={(ev: React.ChangeEvent<HTMLSelectElement>) => setE({ ...e, compte: ev.target.value })} disabled={!canWrite}>{KEYS_65.map((k: string) => <option key={k} value={k}>{ACC_LABEL[k]}</option>)}</select></label>
        <div className="bt-calc" aria-live="polite">
          {eOk ? <>{eCalc.n} mensualités · taux implicite ≈ <b>{(eCalc.tauxAnnuel * 100).toFixed(2).replace('.', ',')} %</b> par an · intérêts totaux <b>{eur2(eInt)}</b>{eCalc.insuffisant ? <span className="neg"> · attention : mensualité × durée &lt; capital, le prêt n’est pas remboursé en totalité</span> : null}</> : <span className="bd-hint">Renseignez organisme, capital, mensualité et dates (la fin doit suivre la première échéance).</span>}
        </div>
        <div className="bt-btns">
          <button type="submit" className="bd-btn primary" disabled={!canWrite || busy || !eOk}>{e.id ? 'Enregistrer les modifications' : '+ Ajouter l’emprunt'}</button>
          {e.id ? <button type="button" className="bd-btn" onClick={() => setE(videE)}>Annuler la modification</button> : null}
        </div>
      </form>
      <div className="bt-wrap" role="region" aria-label="Emprunts" tabIndex={0}>
        <table className="bd-tbl bt-tbl">
          <thead><tr><th className="bt-l">Emprunt</th><th className="n">Capital</th><th className="n">Mensualité</th><th>Échéances</th>{ys.map((y: number) => <th key={y} className="n">{y}</th>)}<th /></tr></thead>
          <tbody>
            {calc.map(({ x, c, a }) => (
              <React.Fragment key={x.id}>
                <tr><th className="bt-l" scope="row">{x.organisme}<small>taux implicite ≈ {(c.tauxAnnuel * 100).toFixed(2).replace('.', ',')} % · {c.n} mensualités</small></th><td className="n">{fmt0(x.capital)}</td><td className="n">{fmt0(x.mensualite)}</td><td>{ym(x.date_premiere_echeance)} → {ym(x.date_fin)}</td>
                  {ys.map((y: number, k: number) => <td key={y} className="n">{fmt0(a[k].soldeFin)}<small>solde au 31/12</small></td>)}
                  <td className="bt-act"><button type="button" className="bd-btn sm" disabled={!canWrite} onClick={() => setE({ id: x.id, organisme: x.organisme, capital: String(x.capital), mensualite: String(x.mensualite), debut: ym(x.date_premiere_echeance), fin: ym(x.date_fin), compte: x.compte_interets })}>Modifier</button>
                    <button type="button" className="bd-btn sm danger" disabled={!canWrite || busy} onClick={() => supprimer('budget_emprunts', x.id)}>{sup === x.id ? 'Confirmer ?' : 'Supprimer'}</button></td></tr>
                <tr className="bt-sub"><th className="bt-l" scope="row">Charge financière (intérêts, {x.compte_interets})</th><td /><td /><td />{ys.map((y: number, k: number) => <td key={y} className="n">{fmt0(a[k].totalInterets)}</td>)}<td /></tr>
                <tr className="bt-sub"><th className="bt-l" scope="row">Capital remboursé</th><td /><td /><td />{ys.map((y: number, k: number) => <td key={y} className="n">{fmt0(a[k].totalPrincipal)}</td>)}<td /></tr>
              </React.Fragment>))}
            {calc.length === 0 ? <tr><td colSpan={ys.length + 5} className="bd-hint" style={{ padding: 12 }}>Aucun emprunt enregistré.</td></tr> : null}
            {calc.length ? <>
              <tr className="bt-tot"><th className="bt-l" scope="row">Total : dette restante au 31/12</th><td /><td /><td />{ys.map((y: number, k: number) => <td key={y} className="n">{fmt0(calc.reduce((s: number, z) => s + z.a[k].soldeFin, 0))}</td>)}<td /></tr>
              <tr className="bt-tot"><th className="bt-l" scope="row">Total : charge financière annuelle (65x)</th><td /><td /><td />{ys.map((y: number, k: number) => <td key={y} className="n">{fmt0(calc.reduce((s: number, z) => s + z.a[k].totalInterets, 0))}</td>)}<td /></tr>
            </> : null}
          </tbody>
        </table>
      </div>

      <h2 className="bt-h">Injection dans le budget {year}</h2>
      <p className="bd-hint">Remplace le contenu mensuel du compte (les sous-lignes éventuelles du compte sont remplacées) ; « ↶ Annuler » de l’onglet Budget rétablit l’état précédent. Les montants alimentent ensuite les charges fixes, le seuil de rentabilité et l’EBITDA de la projection.</p>
      <div className="bt-inj">
        {([['Dotations aux amortissements', injD, 'dotations aux amortissements'], ['Intérêts des emprunts', injI, 'intérêts des emprunts']] as [string, ReturnType<typeof lignesInj>, string][]).map(([titre, l, nom]) => (
          <div className="bt-card" key={titre}>
            <b>{titre}</b>
            <table className="bt-mini"><thead><tr><th>Compte</th><th className="n">Budget actuel</th><th className="n">Nouveau</th><th className="n">Écart</th></tr></thead>
              <tbody>{l.map((x) => <tr key={x.key}><td>{ACC_LABEL[x.key] || x.key}</td><td className="n">{fmt0(x.ancien)}</td><td className="n">{fmt0(x.nouveau)}</td><td className="n">{fmt0(x.nouveau - x.ancien)}</td></tr>)}</tbody></table>
            <span className="bd-hint">{noteInj(l)}</span>
            <button type="button" className="bd-btn primary" disabled={ro || !plan || !l.length} title={ro ? 'Budget verrouillé ou en lecture seule' : ''} onClick={() => onInject(l.map((x) => ({ key: x.key, months: x.months })), nom)}>Injecter dans le budget {year}</button>
          </div>))}
      </div>
    </div>
  );
}

export const BT_CSS = `
.bt-root{display:flex;flex-direction:column;gap:12px}
.bt-h{font-size:16px;margin:14px 0 0;color:var(--brand)}
.bt-wrap{overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:6px;max-height:60vh}
.bt-tbl{min-width:100%}
.bt-tbl th.bt-l{position:sticky;left:0;z-index:2;background:var(--surface);text-align:left;min-width:260px;max-width:300px;white-space:normal;font-weight:600;border-right:1px solid var(--line)}
.bt-tbl thead th.bt-l{background:var(--brand);color:#fff;z-index:4}
.bt-tbl th.bt-l small,.bt-tbl td small{display:block;font-weight:400;font-size:10.5px;color:var(--muted)}
.bt-tbl td{height:auto;padding:5px 8px}
.bt-tbl tr.bt-off td,.bt-tbl tr.bt-off th{opacity:.5}
.bt-tbl tr.bt-tot th,.bt-tbl tr.bt-tot td{background:var(--accent-soft);font-weight:700}
.bt-tbl tr.bt-sub th,.bt-tbl tr.bt-sub td{background:#FFFEF6;font-size:12px}
.bt-act{display:flex;gap:6px;align-items:center;justify-content:flex-end}
.bt-chk{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--muted)}
.bt-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--brand-2);border-radius:6px;padding:12px 14px}
.bt-f{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:var(--muted)}
.bt-f input,.bt-f select{height:34px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);padding:0 8px;font:inherit;font-size:13px;min-width:0}
.bt-f input:focus-visible,.bt-f select:focus-visible{outline:2px solid var(--brand-2);outline-offset:1px}
.bt-calc{grid-column:1/-1;font-size:13px;background:var(--surface-2);border-radius:4px;padding:8px 10px}
.bt-btns{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}
.bt-inj{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
.bt-card{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.bt-mini{border-collapse:collapse;width:100%;font-size:12.5px}
.bt-mini th,.bt-mini td{padding:4px 6px;border-bottom:1px solid var(--line);text-align:left}
.bt-mini .n{text-align:right;font-family:var(--font-mono,'IBM Plex Mono',monospace);font-variant-numeric:tabular-nums}
`;
