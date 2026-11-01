'use client';
// app/apps/budget/Assistants.tsx : assistants du Budget alimentés par les données réelles de La Badjawe
// (paies UCM octobre 2026, ventes par secteur 2025, grands livres 2024-2026).
// Ce composant n'est monté qu'après un clic : aucune valeur numérique ou date n'est rendue côté serveur (pas d'erreur d'hydratation #418).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CHART, MONTHS, accMonths, parseNum, r2, secAccKeys, sum, type Entry } from '@/lib/pcmn';
import {
  CA_DEFAULTS, CA_MONTHLY, EMPLOYEES, TOTAL_RH_2027_REF, FIXED_61, PAIE_REF, RATIOS_60, RATIO_60_DEFAULT, RATIO_60_RANGE, RH_ACCOUNTS, RH_DEFAULTS, SECTORS, SEASON_LABEL,
  applyAchats, applyCa, applyFixed, applyRh, caAnnual, caMonthsOf, coefAnnuel, fixedDefaults, monthlyReference, splitAmount,
  type CaTarget, type Employee, type FixedLine, type RhParams, type Season,
} from '@/lib/defaults';

const nf2 = new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 });
const eur2 = (n: number): string => nf2.format(n) + ' €';
const eur0 = (n: number): string => nf0.format(Math.round(n)) + ' €';
const STORE = 'badjawe-budget-assist';

/** Champ numérique : texte libre pendant la saisie (virgule ou point), valeur validée à la sortie du champ */
function NumIn({ value, onChange, label, disabled, w = 90, dec = 2 }: { value: number; onChange: (n: number) => void; label: string; disabled?: boolean; w?: number; dec?: number }) {
  const [txt, setTxt] = useState<string | null>(null);
  const shown = txt ?? (Number.isFinite(value) ? String(r2(value)).replace('.', ',') : '');
  return (
    <input
      className="as-in" style={{ width: w }} type="text" inputMode="decimal" aria-label={label} disabled={disabled} value={shown}
      onFocus={(e: React.FocusEvent<HTMLInputElement>) => { setTxt(shown); e.currentTarget.select(); }}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTxt(e.target.value)}
      onBlur={() => { if (txt !== null) { const v = parseNum(txt); onChange(Number(v.toFixed(dec))); } setTxt(null); }}
      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

type TabId = 'rh' | 'ca' | 'achats' | 'fixes';
type Props = { rows: Record<string, Entry>; year: number; ro: boolean; onApply: (rows: Record<string, Entry>) => void; onClose: () => void };

export default function Assistants({ rows, year, ro, onApply, onClose }: Props) {
  const [tab, setTab] = useState<TabId>('rh');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [from, setFrom] = useState<number>(year === 2026 ? 11 : 1);
  const [emps, setEmps] = useState<Employee[]>(() => EMPLOYEES.map((e: Employee) => ({ ...e })));
  const [rh, setRh] = useState<RhParams>(() => ({ ...RH_DEFAULTS, ...(year < 2027 ? { gerance: 0, droits: 0 } : {}) })); // gérance et droits d'auteur : référentiel 2027
  const [ca, setCa] = useState<CaTarget>({ ...CA_DEFAULTS });
  const [pcts, setPcts] = useState<number[]>(() => SECTORS.map((s) => s.pct));
  const [locks, setLocks] = useState<(number | null)[]>(() => SECTORS.map(() => null));
  const [ratio, setRatio] = useState<number>(RATIO_60_DEFAULT);
  const [zero60, setZero60] = useState<boolean>(true);
  const [fixed, setFixed] = useState<FixedLine[]>(() => fixedDefaults());
  const loaded = useRef<boolean>(false);

  /* préférences mémorisées dans le navigateur (collaborateurs, paramètres) : lues après le montage seulement */
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (s && typeof s === 'object') {
        if (Array.isArray(s.emps) && s.emps.length) setEmps([...(s.emps as Employee[]), ...EMPLOYEES.filter((d: Employee) => !(s.emps as Employee[]).some((x: Employee) => x.id === d.id)).map((d: Employee) => ({ ...d }))]);
        if (s.rh) setRh((cur: RhParams) => ({ ...RH_DEFAULTS, ...s.rh, gerance: cur.gerance, droits: cur.droits }));
        if (typeof s.ratio === 'number') setRatio(s.ratio);
        if (Array.isArray(s.fixed) && s.fixed.length) setFixed(fixedDefaults().map((d: FixedLine) => (s.fixed as FixedLine[]).find((x: FixedLine) => x.code === d.code) || d));
      }
    } catch { /* stockage indisponible : valeurs par défaut */ }
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try { const { gerance: _g, droits: _d, ...rhSaved } = rh; localStorage.setItem(STORE, JSON.stringify({ emps, rh: rhSaved, ratio, fixed })); } catch { /* ignoré */ }
  }, [emps, rh, ratio, fixed]);

  const ok = (t: string) => setMsg({ ok: true, t });
  const ko = (t: string) => setMsg({ ok: false, t });
  const monthsLbl = (n: number) => MONTHS[n - 1];

  /* ---------- RH ---------- */
  const setEmp = (id: string, patch: Partial<Employee>) => setEmps((l: Employee[]) => l.map((e: Employee) => (e.id === id ? { ...e, ...patch } : e)));
  const ref = useMemo(() => monthlyReference(emps), [emps]);
  const refOk = Math.abs(ref.brut - PAIE_REF.brut) < 0.005 && Math.abs(ref.onss - PAIE_REF.onss) < 0.005 && Math.abs(ref.cr - PAIE_REF.cr) < 0.005;
  const rhPreview = useMemo(() => {
    const r = applyRh({}, emps, year, { ...rh, from });
    let tot = 0; RH_ACCOUNTS.forEach(([k]) => { tot += sum(accMonths(r.rows[k])); });
    return r2(tot);
  }, [emps, rh, from, year]);
  const doRh = () => {
    const r = applyRh(rows, emps, year, { ...rh, from });
    onApply(r.rows);
    ok(`${r.touched} comptes de la classe 62 mis à jour pour ${emps.length} collaborateurs (à partir de ${monthsLbl(from)} ${year}). « ↶ Annuler » rétablit l’état précédent.`);
  };

  /* ---------- CA ---------- */
  const s70 = useMemo(() => CHART.find((s) => s.k === 's70')!, []);
  const target = caAnnual(ca);
  const amounts = useMemo(() => splitAmount(target, pcts, locks), [target, pcts, locks]);
  const sumPct = pcts.reduce((a: number, b: number) => a + b, 0);
  const caNow = sum(caMonthsOf(rows));
  const caRef = (y: number): number => RATIOS_60.find((r) => r.year === y)?.ca ?? sum(CA_MONTHLY[y]);
  const doCa = () => {
    if (!(target > 0)) { ko('Saisissez d’abord un objectif de chiffre d’affaires.'); return; }
    const r = applyCa(rows, SECTORS.map((s, i) => ({ label: s.label, amount: amounts[i] })), ca);
    onApply(r.rows);
    ok(`Objectif de ${eur0(target)} ventilé en ${amounts.filter((a: number) => a > 0).length} secteurs sur le compte ${ca.account}${r.zeroed ? ` ; ${r.zeroed} autre(s) compte(s) 70 remis à zéro` : ''}.`);
  };

  /* ---------- Achats 60 ---------- */
  const target60 = caNow * ratio / 100;
  const doAchats = () => {
    if (!(caNow > 0)) { ko('Le chiffre d’affaires du budget est vide : renseignez-le d’abord (onglet « CA par secteur »).'); return; }
    const r = applyAchats(rows, ratio, from, zero60);
    onApply(r.rows);
    ok(`${r.n} comptes de la classe 60 calibrés à ${nf2.format(ratio)} % du CA mensuel (${eur0(r.total)} sur l’année, à partir de ${monthsLbl(from)}).`);
  };

  /* ---------- Charges fixes 61 ---------- */
  const setFx = (code: string, patch: Partial<FixedLine>) => setFixed((l: FixedLine[]) => l.map((f: FixedLine) => (f.code === code ? { ...f, ...patch } : f)));
  const fxMonthly = fixed.reduce((a: number, f: FixedLine) => a + (f.on ? f.monthly : 0), 0);
  const cats = useMemo(() => Array.from(new Set(FIXED_61.map((f) => f.cat))), []);
  const doFixed = () => {
    const r = applyFixed(rows, fixed, from);
    onApply(r.rows);
    ok(`${r.n} comptes de charges fixes alimentés (${eur0(fxMonthly)} par mois, à partir de ${monthsLbl(from)}).`);
  };

  const tabBtn = (id: TabId, label: string) => <button type="button" role="tab" aria-selected={tab === id} className="as-tab" onClick={() => { setTab(id); setMsg(null); }}>{label}</button>;
  const fromSel = (
    <label className="as-row">Appliquer à partir de
      <select aria-label="Premier mois recalculé" value={from} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFrom(+e.target.value)}>
        {MONTHS.map((m: string, i: number) => <option key={m} value={i + 1}>{m} {year}</option>)}
      </select>
      <span className="bd-hint">Les mois précédents gardent leurs montants actuels.</span>
    </label>
  );

  return (
    <section className="bd-modal as-root" aria-label="Assistants du budget">
      <div className="bd-modal-h"><b>Assistants du budget {year}</b><button type="button" className="bd-x" aria-label="Fermer" onClick={onClose}>×</button></div>
      <div role="tablist" aria-label="Assistants" className="as-tabs">
        {tabBtn('rh', 'RH & masse salariale')}{tabBtn('ca', 'CA par secteur')}{tabBtn('achats', 'Achats (60)')}{tabBtn('fixes', 'Charges fixes (61)')}
      </div>
      {ro ? <p className="bd-hint">Lecture seule : votre rôle ne permet pas de modifier le budget.</p> : null}

      {tab === 'rh' ? (
        <div role="tabpanel" className="as-panel">
          <p className="bd-hint">Base : journal de paie UCM n°20 (octobre 2026). Les montants sont répartis en lignes de détail par collaborateur dans les comptes 620201, 621020, 6232xx…, plus la rémunération du dirigeant (618000) et les droits d’auteur (613400). Stanislas HERMAN (directeur) est prévu à partir de 2027 : ajustez sa date d’entrée si besoin.</p>
          <div className="as-scroll">
            <table className="as-tbl">
              <thead><tr><th>Collaborateur</th><th>Entrée</th><th>Sortie</th><th className="n">Brut mensuel</th><th className="n">dont ATN</th><th className="n">ONSS patronal net</th><th className="n">Déplacements / frais</th><th className="n">Chèques-repas</th><th className="n">Télétravail</th><th className="n">Représentation</th><th>Pécule / PFA</th></tr></thead>
              <tbody>
                {emps.map((e: Employee) => (
                  <tr key={e.id}>
                    <td><b>{e.name}</b><div className="as-sub">{e.role} · {e.regime}</div></td>
                    <td><input className="as-in" type="date" aria-label={`Entrée de ${e.name}`} value={e.start} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setEmp(e.id, { start: ev.target.value })} /></td>
                    <td><input className="as-in" type="date" aria-label={`Sortie de ${e.name}`} value={e.end ?? ''} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setEmp(e.id, { end: ev.target.value || null })} /></td>
                    <td className="n"><NumIn value={e.brut} label={`Brut mensuel de ${e.name}`} onChange={(v: number) => setEmp(e.id, { brut: v })} /></td>
                    <td className="n"><NumIn value={e.atn} label={`ATN de ${e.name}`} w={64} onChange={(v: number) => setEmp(e.id, { atn: v })} /></td>
                    <td className="n"><NumIn value={e.onss} label={`ONSS patronal de ${e.name}`} onChange={(v: number) => setEmp(e.id, { onss: v })} /></td>
                    <td className="n"><NumIn value={e.transport} label={`Déplacements de ${e.name}`} w={72} onChange={(v: number) => setEmp(e.id, { transport: v })} /></td>
                    <td className="n"><NumIn value={e.titres} label={`Titres-repas de ${e.name}`} w={48} dec={0} onChange={(v: number) => setEmp(e.id, { titres: v })} /> × {nf2.format(e.crPart)} €</td>
                    <td className="n"><NumIn value={e.telework} label={`Télétravail de ${e.name}`} w={64} onChange={(v: number) => setEmp(e.id, { telework: v })} /></td>
                    <td className="n"><NumIn value={e.repres} label={`Représentation de ${e.name}`} w={64} onChange={(v: number) => setEmp(e.id, { repres: v })} /></td>
                    <td><label className="as-chk"><input type="checkbox" checked={e.extras} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setEmp(e.id, { extras: ev.target.checked })} />oui</label></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}><b>Total mensuel du journal de paie (4 contrats)</b></td><td className="n">{eur2(ref.brut)}</td><td /><td className="n">{eur2(ref.onss)}</td><td /><td className="n">{eur2(ref.cr)}</td><td colSpan={3} /></tr></tfoot>
            </table>
          </div>
          <p className={refOk ? 'as-ok' : 'bd-hint'}>{refOk ? `✓ Conforme au journal de paie : brut ${eur2(PAIE_REF.brut)}, ONSS patronal net ${eur2(PAIE_REF.onss)}, chèques-repas ${eur2(PAIE_REF.cr)}.` : `Écart avec le journal de paie d’octobre (brut ${eur2(PAIE_REF.brut)}, ONSS ${eur2(PAIE_REF.onss)}, chèques-repas ${eur2(PAIE_REF.cr)}) : les données ont été modifiées.`}</p>
          <div className="as-grid">
            <label className="as-row">Double pécule <NumIn value={rh.dp} label="Double pécule en mois de brut" w={60} onChange={(v: number) => setRh({ ...rh, dp: v })} /> mois, payé en
              <select aria-label="Mois du double pécule" value={rh.moisDp} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRh({ ...rh, moisDp: +e.target.value })}>{MONTHS.map((m: string, i: number) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
            <label className="as-row">Prime de fin d’année <NumIn value={rh.pfa} label="Prime de fin d’année en mois de brut" w={60} onChange={(v: number) => setRh({ ...rh, pfa: v })} /> mois, payée en
              <select aria-label="Mois de la prime de fin d’année" value={rh.moisPfa} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRh({ ...rh, moisPfa: +e.target.value })}>{MONTHS.map((m: string, i: number) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
            <label className="as-row">ONSS patronal sur ces paiements <NumIn value={rh.onssExtraPct} label="Taux ONSS sur pécule et prime" w={60} onChange={(v: number) => setRh({ ...rh, onssExtraPct: v })} /> %</label>
            <label className="as-row">Rémunération du dirigeant (618) <NumIn value={rh.gerance} label="Rémunération mensuelle du dirigeant" w={90} onChange={(v: number) => setRh({ ...rh, gerance: v })} /> € / mois HTVA</label>
            <label className="as-row">Droits d’auteur (61) <NumIn value={rh.droits} label="Droits d’auteur annuels" w={100} onChange={(v: number) => setRh({ ...rh, droits: v })} /> € / an, lissés sur les mois</label>
            <label className="as-chk"><input type="checkbox" checked={rh.prorata} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRh({ ...rh, prorata: e.target.checked })} />Prorata des jours en cas d’entrée ou de sortie en cours de mois</label>
          </div>
          {fromSel}
          <p className="bd-hint">Coefficient annuel (CP 220) : 12 + {nf2.format(rh.dp)} + {nf2.format(rh.pfa)} = <b>{nf2.format(coefAnnuel(rh))} mois</b> de brut. Le surcoût (≈ {nf2.format((coefAnnuel(rh) - 12) / 12 * 100)} % du brut) est provisionné chaque mois (625020) et repris lors du paiement (625120), comme dans le grand livre. Le taux d’ONSS sur ces paiements est le taux brut du journal : 2.576,17 € / 9.509,97 € = 27,09 %.</p>
          <div className="as-act"><button type="button" className="bd-btn primary" disabled={ro} onClick={doRh}>Appliquer au budget</button><span className="as-tot">Total RH + direction ({year}, à partir de {monthsLbl(from)}) : <b>{eur0(rhPreview)}</b>{from === 1 && year === 2027 ? <> · référence annoncée ≈ {eur0(TOTAL_RH_2027_REF)} (suppose Noah présent toute l’année ; son contrat se termine le 12/09/2027)</> : null}</span></div>
        </div>
      ) : null}

      {tab === 'ca' ? (
        <div role="tabpanel" className="as-panel">
          <p className="bd-hint">Clés de répartition constatées en 2025 (ventes par secteur, 396.402 € de CA). Saisissez un objectif annuel ou mensuel : il est ventilé automatiquement, et chaque montant reste ajustable (un montant modifié est verrouillé, le reste est réparti au prorata).</p>
          <div className="as-grid">
            <label className="as-row">Objectif de CA <NumIn value={ca.amount} label="Objectif de chiffre d’affaires" w={110} onChange={(v: number) => setCa({ ...ca, amount: v })} /> €
              <select aria-label="Période de l’objectif" value={ca.kind} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCa({ ...ca, kind: e.target.value as CaTarget['kind'] })}><option value="annual">par an</option><option value="monthly">par mois</option></select></label>
            <label className="as-row">Saisonnalité
              <select aria-label="Saisonnalité" disabled={ca.kind === 'monthly'} value={ca.kind === 'monthly' ? 'flat' : ca.season} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCa({ ...ca, season: e.target.value as Season })}>
                {(Object.keys(SEASON_LABEL) as Season[]).map((s: Season) => <option key={s} value={s}>{SEASON_LABEL[s]}</option>)}
              </select></label>
            <label className="as-row">Compte porteur
              <select aria-label="Compte porteur" value={ca.account} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCa({ ...ca, account: e.target.value })}>
                {secAccKeys(s70).map((k: string) => <option key={k} value={k}>{k}</option>)}
              </select></label>
            <label className="as-chk"><input type="checkbox" checked={ca.zeroOthers} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCa({ ...ca, zeroOthers: e.target.checked })} />Remettre à zéro les autres comptes 70 (le CA total est porté par le compte choisi)</label>
          </div>
          <div className="as-row">Reprendre :
            {[2024, 2025].map((y: number) => <button key={y} type="button" className="bd-btn sm" onClick={() => setCa({ ...ca, kind: 'annual', amount: caRef(y) })}>CA {y} ({eur0(caRef(y))})</button>)}
            <span className="bd-hint">CA actuellement budgété : {eur0(caNow)}</span>
          </div>
          <div className="as-scroll">
            <table className="as-tbl">
              <thead><tr><th>Secteur</th><th className="n">Clé (%)</th><th className="n">Montant annuel</th><th /></tr></thead>
              <tbody>
                {SECTORS.map((s, i: number) => (
                  <tr key={s.k}>
                    <td><b>{s.label}</b><div className="as-sub">{s.desc}</div></td>
                    <td className="n"><NumIn value={pcts[i]} label={`Clé de ${s.label}`} w={70} onChange={(v: number) => setPcts((l: number[]) => l.map((x: number, j: number) => (j === i ? v : x)))} /> %</td>
                    <td className="n"><NumIn value={amounts[i]} label={`Montant de ${s.label}`} w={110} onChange={(v: number) => setLocks((l: (number | null)[]) => l.map((x: number | null, j: number) => (j === i ? v : x)))} /> €</td>
                    <td>{locks[i] !== null ? <button type="button" className="bd-btn sm" title="Revenir à la clé de répartition" onClick={() => setLocks((l: (number | null)[]) => l.map((x: number | null, j: number) => (j === i ? null : x)))}>↺ clé</button> : null}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td><b>Total</b></td><td className="n">{nf2.format(sumPct)} %</td><td className="n">{eur2(amounts.reduce((a: number, b: number) => a + b, 0))}</td><td /></tr></tfoot>
            </table>
          </div>
          {Math.abs(sumPct - 100) > 0.005 ? <p className="bd-hint">Les clés totalisent {nf2.format(sumPct)} % (arrondis des pourcentages saisis) : elles sont normalisées, le total ventilé reste exactement égal à l’objectif.</p> : null}
          <div className="as-act"><button type="button" className="bd-btn primary" disabled={ro || !(target > 0)} onClick={doCa}>Ventiler dans le budget</button><span className="as-tot">Objectif annuel : <b>{eur0(target)}</b></span></div>
        </div>
      ) : null}

      {tab === 'achats' ? (
        <div role="tabpanel" className="as-panel">
          <p className="bd-hint">Les achats de la classe 60 sont calibrés en pourcentage du chiffre d’affaires de chaque mois, puis répartis entre les comptes selon la structure réelle de 2025 et 2026 (matières premières, emballages, accises…). Les variations de stock (609xxx, 710xxx) sont mises à zéro : le ratio s’applique donc au net.</p>
          <div className="as-scroll">
            <table className="as-tbl">
              <thead><tr><th>Année</th><th className="n">CA (70)</th><th className="n">Classe 60</th><th className="n">Ratio</th></tr></thead>
              <tbody>{RATIOS_60.map((r) => <tr key={r.year}><td>{r.year}{r.partial ? ' (janv.–oct.)' : ''}</td><td className="n">{eur0(r.ca)}</td><td className="n">{eur0(r.s60)}</td><td className="n"><b>{nf2.format(r.pct)} %</b></td></tr>)}</tbody>
            </table>
          </div>
          <div className="as-row">Ratio achats / CA <NumIn value={ratio} label="Ratio achats sur chiffre d’affaires" w={70} onChange={(v: number) => setRatio(v)} /> %
            {[RATIO_60_RANGE[0], RATIO_60_DEFAULT, RATIO_60_RANGE[1]].map((v: number) => <button key={v} type="button" className="bd-btn sm" aria-pressed={ratio === v} onClick={() => setRatio(v)}>{nf2.format(v)} %</button>)}
            <span className="bd-hint">fourchette observée : {RATIO_60_RANGE[0]} % à {RATIO_60_RANGE[1]} % selon le mix brassins en propre / à façon</span></div>
          <label className="as-chk"><input type="checkbox" checked={zero60} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setZero60(e.target.checked)} />Remettre à zéro les autres comptes de la classe 60 (variations de stock comprises)</label>
          {fromSel}
          <div className="as-act"><button type="button" className="bd-btn primary" disabled={ro} onClick={doAchats}>Appliquer au budget</button><span className="as-tot">CA budgété {eur0(caNow)} → achats cibles <b>{eur0(target60)}</b></span></div>
        </div>
      ) : null}

      {tab === 'fixes' ? (
        <div role="tabpanel" className="as-panel">
          <p className="bd-hint">Charges récurrentes du grand livre 2026 : loyer et charges du bâtiment d’Alleur, énergie, assurances, abonnements et logiciels, maintenance. Le montant mensuel proposé est la médiane des mois facturés d’avril à octobre 2026 (ou la moyenne janvier–octobre pour les charges irrégulières) ; il reste modifiable.</p>
          <div className="as-scroll">
            <table className="as-tbl">
              <thead><tr><th /><th>Compte</th><th className="n">Réalisé 2025</th><th className="n">2026 (janv.–oct.)</th><th className="n">Par mois</th><th>Base</th></tr></thead>
              {cats.map((c: string) => (
                <tbody key={c}>
                  <tr className="as-cat"><td colSpan={6}>{c}</td></tr>
                  {FIXED_61.filter((f) => f.cat === c).map((f) => {
                    const l = fixed.find((x: FixedLine) => x.code === f.code)!;
                    return (
                      <tr key={f.code}>
                        <td><input type="checkbox" aria-label={`Inclure ${f.name}`} checked={l.on} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFx(f.code, { on: e.target.checked })} /></td>
                        <td><b>{f.code}</b> {f.name}</td><td className="n">{eur0(f.y2025)}</td><td className="n">{eur0(f.y2026)}</td>
                        <td className="n"><NumIn value={l.monthly} label={`Montant mensuel de ${f.name}`} w={84} onChange={(v: number) => setFx(f.code, { monthly: v })} /></td>
                        <td className="as-sub">{f.basis}</td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
              <tfoot><tr><td /><td colSpan={3}><b>Total mensuel retenu</b></td><td className="n">{eur2(fxMonthly)}</td><td /></tr></tfoot>
            </table>
          </div>
          {fromSel}
          <div className="as-act"><button type="button" className="bd-btn primary" disabled={ro} onClick={doFixed}>Appliquer au budget</button><span className="as-tot">Soit <b>{eur0(fxMonthly * 12)}</b> par an</span></div>
        </div>
      ) : null}

      {msg ? <div role="status" className={msg.ok ? 'li-msg ok' : 'li-msg err'}>{msg.t}</div> : null}
    </section>
  );
}

export const AS_CSS = `
.as-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--line)}
.as-tab{appearance:none;border:0;border-bottom:3px solid transparent;background:transparent;color:var(--muted);font:inherit;font-size:14px;font-weight:600;padding:8px 14px;cursor:pointer}
.as-tab[aria-selected=true]{color:var(--ink);border-bottom-color:var(--brand-2)}
.as-tab:focus-visible{outline:2px solid var(--brand-2);outline-offset:1px}
.as-panel{display:flex;flex-direction:column;gap:10px}
.as-scroll{overflow:auto;border:1px solid var(--line);border-radius:6px}
.as-tbl{width:100%;border-collapse:collapse;font-size:13px}
.as-tbl th{background:var(--brand);color:#fff;text-align:left;font-size:12px;padding:6px 8px;white-space:nowrap}
.as-tbl td{padding:5px 8px;border-top:1px solid var(--line);vertical-align:middle}
.as-tbl th.n,.as-tbl td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.as-tbl tfoot td{background:var(--surface-2);font-weight:600}
.as-tbl tr.as-cat td{background:var(--accent-soft);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
.as-sub{font-size:11.5px;color:var(--muted);font-weight:400}
.as-in{height:28px;border:1px solid var(--line);border-radius:3px;background:var(--surface);color:var(--ink);padding:0 6px;font:inherit;font-size:13px;text-align:right;min-width:0}
.as-in[type=date]{text-align:left}
.as-in:focus-visible{outline:2px solid var(--brand-2);outline-offset:1px}
.as-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px}
.as-row select{height:28px;border:1px solid var(--line);border-radius:3px;background:var(--surface);color:var(--ink);font:inherit;font-size:13px}
.as-chk{display:inline-flex;align-items:center;gap:6px;font-size:13px}
.as-grid{display:grid;gap:8px 18px;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))}
.as-act{display:flex;flex-wrap:wrap;align-items:center;gap:14px}
.as-tot{font-size:13px;color:var(--muted)}
.as-ok{font-size:12px;color:#2F6B3C;margin:2px 0}
`;
