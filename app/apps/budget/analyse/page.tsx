'use client';
/* =====================================================================
   app/apps/budget/analyse/page.tsx : « Projection 3 ans » de la Brasserie coopérative La Badjawe
   - compare trois budgets (année + scénario) : ex. 2026 atterrissage, 2027 budget, 2028 projection
   - cartes KPI à double affichage (en % du CA et en % de la marge brute), seuil de rentabilité
   - graphiques SVG : barres groupées (CA / marge brute / EBITDA), anneau d'absorption de la marge brute, point mort vs CA
   Lecture seule. Données : pcmn_budget_plans (sql/02, sql/04, sql/06 pour les scénarios).
   Hydratation : tout est chargé côté client après le montage ; aucun format de nombre ni de date n'est calculé au rendu serveur.
   ===================================================================== */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppHeader from '@/components/AppHeader';
import { createClient } from '@/lib/supabase/client';
import { cloneEntry, eur0, parseNum, type Entry } from '@/lib/pcmn';
import { computeKpis, type Kpis } from '@/lib/projection';
import { C, CH_CSS, Doughnut, GroupedBars, LineChart, type Part, type Serie } from './Charts';

type PlanRow = { key: string; year: number; scenario: string; title: string; locked: boolean; rows: Record<string, Entry> };
const BASE_YEAR = 2026;
const keyOf = (year: number, scenario: string) => year + '|' + scenario;
const pct1 = (x: number) => (Number.isFinite(x) ? (Math.round(x * 1000) / 10).toFixed(1).replace('.', ',') + ' %' : '—');
const labelOf = (p: PlanRow) => p.year + ' · ' + p.title + (p.locked ? ' (verrouillé)' : '');

/** budget retenu par défaut pour une année : verrouillé > « base » > premier */
function pickFor(plans: PlanRow[], year: number): string {
  const l = plans.filter((p: PlanRow) => p.year === year);
  const c = l.find((p: PlanRow) => p.locked) || l.find((p: PlanRow) => p.scenario === 'base') || l[0];
  return c ? c.key : '';
}

export default function ProjectionPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const routerRef = React.useRef(router); routerRef.current = router;
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [sel, setSel] = useState<string[]>(['', '', '']);

  const load = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth || !auth.user) { routerRef.current.replace('/login?next=/apps/budget/analyse'); return; }
      const acc = await supabase.rpc('has_app_access', { p_route: '/apps/budget' });
      if (!acc.error && acc.data === false) { routerRef.current.replace('/dashboard'); return; }
      let r: any = await supabase.from('pcmn_budget_plans').select('year,scenario,title,is_locked,data').order('year');
      let hs = true;
      if (r.error && /scenario|is_locked|title/i.test(r.error.message || '')) { hs = false; r = await supabase.from('pcmn_budget_plans').select('year,data').order('year'); }
      if (r.error) {
        const m: string = r.error.message || '';
        setNotice(/relation|does not exist|schema cache/i.test(m) ? 'Les tables du budget n’existent pas encore : exécutez sql/02_budget_pcmn.sql (puis sql/06_budget_scenarios.sql) dans Supabase.' : 'Chargement impossible : ' + m);
      } else {
        const list: PlanRow[] = ((r.data || []) as any[]).map((x: any) => {
          const rows: Record<string, Entry> = {}; const raw = x.data && x.data.rows ? x.data.rows : {};
          Object.keys(raw).forEach((k: string) => { rows[k] = cloneEntry(raw[k]); });
          const sc: string = hs ? x.scenario : 'base';
          return { key: keyOf(x.year, sc), year: x.year, scenario: sc, title: hs ? x.title || (sc === 'base' ? 'Budget ' + x.year : sc) : 'Budget ' + x.year, locked: hs ? !!x.is_locked : false, rows };
        });
        setPlans(list);
        // trois années consécutives : 2026, 2027, 2028 ; à défaut, les trois premières années disponibles
        const wanted = [BASE_YEAR, BASE_YEAR + 1, BASE_YEAR + 2].map((y: number) => pickFor(list, y));
        if (wanted.every((k: string) => !k) && list.length) {
          const ys = [...new Set(list.map((p: PlanRow) => p.year))].sort((a: number, b: number) => a - b).slice(0, 3);
          setSel([pickFor(list, ys[0]), ys[1] ? pickFor(list, ys[1]) : '', ys[2] ? pickFor(list, ys[2]) : '']);
        } else setSel(wanted);
        setNotice(list.length ? '' : 'Aucun budget enregistré : créez d’abord un budget dans « Budget prévisionnel ».');
      }
    } catch (e: any) {
      setNotice('Chargement impossible : ' + (e && e.message ? e.message : 'erreur réseau'));
    }
    setReady(true);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const cols = useMemo(() => sel.map((k: string) => {
    const p = plans.find((x: PlanRow) => x.key === k);
    return p ? { plan: p, k: computeKpis(p.rows) } : null;
  }), [sel, plans]);
  const act = cols.filter((c) => c !== null) as { plan: PlanRow; k: Kpis }[];

  const setCol = (i: number, v: string) => setSel((s: string[]) => s.map((x: string, j: number) => (j === i ? v : x)));
  const labels = act.map((c) => String(c.plan.year));

  const right = <Link href="/apps/budget" className="pj-back">← Budget</Link>;
  return (
    <div className="pj-root">
      <style>{PJ_CSS + CH_CSS}</style>
      <AppHeader title="Projection 3 ans" right={right} />
      <main className="pj-main">
        {!ready ? <p className="pj-note" role="status">Chargement…</p> : (
          <>
            {notice ? <p className="pj-warn" role="alert">{notice}</p> : null}
            <section className="pj-sel" aria-label="Choix des trois budgets">
              {[0, 1, 2].map((i: number) => (
                <label key={i} className="pj-f">{i === 0 ? 'Année 1 (atterrissage)' : i === 1 ? 'Année 2 (budget)' : 'Année 3 (projection)'}
                  <select value={sel[i]} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCol(i, e.target.value)}>
                    <option value="">— aucun —</option>
                    {plans.map((p: PlanRow) => <option key={p.key} value={p.key}>{labelOf(p)}</option>)}
                  </select>
                </label>
              ))}
            </section>

            {act.length === 0 ? <p className="pj-note">Sélectionnez au moins un budget.</p> : (
              <>
                <section className="pj-kpis" aria-label="Indicateurs par année">
                  {act.map((c) => <KpiCard key={c.plan.key} plan={c.plan} k={c.k} />)}
                </section>

                <section className="pj-grid">
                  <figure className="pj-card">
                    <figcaption>Chiffre d’affaires, marge brute et EBITDA</figcaption>
                    <GroupedBars title="Barres groupées : CA, marge brute, EBITDA" labels={labels} fmt={eur0}
                      series={[
                        { name: 'Chiffre d’affaires', color: C.night, values: act.map((c) => c.k.ca) },
                        { name: 'Marge brute', color: C.gold, values: act.map((c) => c.k.mb) },
                        { name: 'EBITDA', color: C.green, values: act.map((c) => c.k.ebitda) },
                      ] as Serie[]} />
                    <Legend items={[['Chiffre d’affaires', C.night], ['Marge brute', C.gold], ['EBITDA', C.green]]} />
                  </figure>

                  <figure className="pj-card">
                    <figcaption>Point mort et chiffre d’affaires prévisionnel</figcaption>
                    <LineChart title="Courbes : seuil de rentabilité et CA prévisionnel" labels={labels} fmt={eur0}
                      series={[
                        { name: 'CA prévisionnel', color: C.night, values: act.map((c) => c.k.ca) },
                        { name: 'Seuil de rentabilité', color: C.gold, dash: '6 4', values: act.map((c) => c.k.breakeven) },
                      ] as Serie[]} />
                    <Legend items={[['CA prévisionnel', C.night], ['Seuil de rentabilité', C.gold]]} />
                  </figure>
                </section>

                <BreakEven act={act} />

                <section className="pj-donuts" aria-label="Absorption de la marge brute">
                  <h2>Absorption de la marge brute</h2>
                  <div className="pj-dgrid">
                    {act.map((c) => <Absorb key={c.plan.key} plan={c.plan} k={c.k} />)}
                  </div>
                </section>

                <details className="pj-def">
                  <summary>Définitions des indicateurs</summary>
                  <ul>
                    <li><b>Marge brute</b> = chiffre d’affaires (classe 70) − achats de marchandises et matières (classe 60). <b>Taux</b> = marge brute / CA.</li>
                    <li><b>Personnel</b> = classe 62 (salariés) + consultance management du dirigeant (618000) + droits d’auteur (613400), ces deux comptes étant rangés dans « Personnel externe ».</li>
                    <li><b>Frais généraux</b> = classe 61 (la direction et les droits d’auteur n’en font plus partie).</li>
                    <li><b>Charges fixes</b> = personnel + frais généraux + consultances externes hors direction + énergie + amortissements et provisions + autres charges d’exploitation + charges financières − autres produits (74, 71;74, 75, vinaigrerie net).</li>
                    <li><b>Seuil de rentabilité</b> = charges fixes / taux de marge brute : le CA à partir duquel la marge brute couvre toutes les charges fixes.</li>
                    <li><b>Résultat d’exploitation (anneau)</b> = marge brute − personnel − frais généraux ; s’il est négatif, le déficit est signalé à part.</li>
                  </ul>
                </details>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------
   Seuil de rentabilité (point mort) : CA d'équilibre et équivalent en hectolitres
   CA d'équilibre = charges fixes nettes / taux de marge sur coûts variables (variables = achats, classe 60)
   Volume (HL) = CA / prix moyen de vente à l'hectolitre (paramètre mémorisé dans ce navigateur)
   ------------------------------------------------------------------ */
const PRIX_KEY = 'badjawe-projection-prix-hl';
const PRIX_DEFAUT = 300;
const nf1 = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 1 });
const hl = (x: number) => (Number.isFinite(x) ? nf1.format(x) + ' HL' : '—');

function BreakEven({ act }: { act: { plan: PlanRow; k: Kpis }[] }) {
  const [txt, setTxt] = useState(String(PRIX_DEFAUT));
  useEffect(() => { try { const v = localStorage.getItem(PRIX_KEY); if (v) setTxt(v); } catch { /* navigation privée : sans importance */ } }, []);
  const prix = parseNum(txt);
  const maj = (v: string) => { setTxt(v); try { localStorage.setItem(PRIX_KEY, v); } catch { /* sans importance */ } };
  const ok = prix > 0;
  const lignes: { label: string; hint?: string; cell: (k: Kpis) => React.ReactNode; strong?: boolean }[] = [
    { label: 'Charges fixes nettes', hint: 'Personnel, frais généraux, énergie, amortissements, charges financières… moins les autres produits', cell: (k: Kpis) => eur0(k.fixed) },
    { label: 'Taux de marge sur coûts variables', hint: '(CA − achats classe 60) / CA', cell: (k: Kpis) => pct1(k.mbPct) },
    { label: 'CA d’équilibre (seuil de rentabilité)', hint: 'Charges fixes nettes / taux de marge sur coûts variables', cell: (k: Kpis) => (k.mbPct > 0 ? eur0(k.breakeven) : 'non atteignable'), strong: true },
    { label: 'CA prévisionnel', cell: (k: Kpis) => eur0(k.ca) },
    { label: 'Écart CA prévu − CA d’équilibre', cell: (k: Kpis) => (k.mbPct > 0 ? (k.ca - k.breakeven >= 0 ? '+' : '−') + eur0(Math.abs(k.ca - k.breakeven)) : '—') },
    { label: 'Volume d’équilibre à produire / vendre', hint: 'CA d’équilibre / prix moyen par HL', cell: (k: Kpis) => (ok && k.mbPct > 0 ? hl(k.breakeven / prix) : '—'), strong: true },
    { label: 'Volume équivalent au CA prévisionnel', cell: (k: Kpis) => (ok ? hl(k.ca / prix) : '—') },
    { label: 'Volume d’écart (prévu − équilibre)', cell: (k: Kpis) => (ok && k.mbPct > 0 ? (k.ca - k.breakeven >= 0 ? '+' : '−') + hl(Math.abs(k.ca - k.breakeven) / prix) : '—') },
  ];
  return (
    <section className="pj-be" aria-label="Seuil de rentabilité et volume équivalent">
      <h2>Seuil de rentabilité : CA d’équilibre et volume (HL)</h2>
      <div className="pj-be-p">
        <label className="pj-f" htmlFor="pj-prix">Prix moyen de vente (€ HTVA / hectolitre)
          <input id="pj-prix" type="text" inputMode="decimal" value={txt} onChange={(e: React.ChangeEvent<HTMLInputElement>) => maj(e.target.value)} aria-invalid={!ok} />
        </label>
        <p className="pj-note" style={{ margin: 0 }}>{ok ? <>Soit {nf1.format(prix / 100)} € le litre. Paramètre mémorisé dans ce navigateur ; la valeur par défaut ({PRIX_DEFAUT} €/HL) est une hypothèse à ajuster.</> : 'Indiquez un prix supérieur à 0 pour convertir le CA en hectolitres.'}</p>
      </div>
      <div className="pj-be-w" role="region" aria-label="Tableau du seuil de rentabilité" tabIndex={0}>
        <table className="pj-be-t">
          <thead><tr><th scope="col">Indicateur</th>{act.map((c) => <th key={c.plan.key} scope="col">{c.plan.year}<small>{c.plan.title}</small></th>)}</tr></thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.label} className={l.strong ? 'st' : ''}>
                <th scope="row" title={l.hint}>{l.label}{l.hint ? <small>{l.hint}</small> : null}</th>
                {act.map((c) => <td key={c.plan.key} className={l.strong && c.k.ca < c.k.breakeven ? 'neg' : ''}>{l.cell(c.k)}</td>)}
              </tr>))}
          </tbody>
        </table>
      </div>
      {act.some((c) => c.k.mbPct <= 0) ? <p className="pj-warn" role="note">Un budget a un taux de marge nul ou négatif : aucun CA ne couvre les charges fixes (seuil non atteignable).</p> : null}
      <p className="pj-note">Les coûts variables sont les achats de la classe 60 ; toutes les autres charges sont traitées comme fixes. Les dotations aux amortissements (630) et les intérêts (65) injectés depuis l’onglet « Investissements, Emprunts &amp; Amortissements » du Budget sont inclus dans les charges fixes.</p>
    </section>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return <div className="pj-lg">{items.map((it: [string, string]) => <span key={it[0]}><i style={{ background: it[1] }} />{it[0]}</span>)}</div>;
}

function Ratio({ label, a, b, aLab, bLab, warn }: { label: string; a: string; b: string; aLab: string; bLab: string; warn?: boolean }) {
  return (
    <div className={'pj-ratio' + (warn ? ' warn' : '')}>
      <div className="pj-rl">{label}</div>
      <div className="pj-rv"><span><b>{a}</b><small>{aLab}</small></span><span><b>{b}</b><small>{bLab}</small></span></div>
    </div>
  );
}

function KpiCard({ plan, k }: { plan: PlanRow; k: Kpis }) {
  const gap = k.ca - k.breakeven;
  return (
    <article className="pj-kpi">
      <header>
        <h3>{plan.year}</h3>
        <span className={'pj-tag' + (plan.locked ? ' lk' : '')}>{plan.title}{plan.locked ? ' · verrouillé' : ''}</span>
      </header>
      <dl className="pj-base">
        <div><dt>Chiffre d’affaires</dt><dd>{eur0(k.ca)}</dd></div>
        <div><dt>Marge brute</dt><dd>{eur0(k.mb)}</dd></div>
        <div><dt>EBITDA</dt><dd className={k.ebitda < 0 ? 'neg' : ''}>{eur0(k.ebitda)}</dd></div>
      </dl>
      <Ratio label="Taux de marge brute" a={pct1(k.mbPct)} b={eur0(k.achats)} aLab="de marge sur le CA" bLab="achats (60)" />
      <Ratio label={'Poids du personnel · ' + eur0(k.rh)} a={pct1(k.rhPctCa)} b={pct1(k.rhPctMb)} aLab="du CA" bLab="de la marge brute" warn={k.rhPctMb > 0.6} />
      <Ratio label={'Poids des frais généraux · ' + eur0(k.fg)} a={pct1(k.fgPctCa)} b={pct1(k.fgPctMb)} aLab="du CA" bLab="de la marge brute" warn={k.fgPctMb > 0.4} />
      <Ratio label={'Seuil de rentabilité'} a={eur0(k.breakeven)} b={(gap >= 0 ? '+' : '−') + eur0(Math.abs(gap))} aLab={'charges fixes ' + eur0(k.fixed)} bLab={gap >= 0 ? 'CA au-dessus du seuil' : 'CA sous le seuil'} warn={gap < 0} />
      <details className="pj-fx">
        <summary>Détail des charges fixes · {eur0(k.fixed)}</summary>
        <ul>{k.fixedParts.map((x: { label: string; v: number }) => <li key={x.label}><span>{x.label}</span><b>{eur0(x.v)}</b></li>)}</ul>
        <p>Seuil = {eur0(k.fixed)} / {pct1(k.mbPct)} de taux de marge brute.</p>
      </details>
    </article>
  );
}

function Absorb({ plan, k }: { plan: PlanRow; k: Kpis }) {
  const res = k.result;
  const parts: Part[] = [
    { label: 'Personnel', value: k.rh, color: C.night },
    { label: 'Frais généraux', value: k.fg, color: C.slate },
    { label: 'Résultat d’exploitation', value: res, color: C.gold },
  ];
  // si le résultat est négatif, l'anneau montre l'absorption à 100 % (RH + FG limités à la marge brute) et le déficit est dit en toutes lettres
  const deficit = res < 0;
  const shown: Part[] = deficit ? [{ ...parts[0], value: k.rh }, { ...parts[1], value: k.fg }] : parts;
  return (
    <figure className="pj-card">
      <figcaption>{plan.year} · {plan.title}</figcaption>
      <Doughnut title={'Absorption de la marge brute ' + plan.year} parts={shown} big={pct1(k.mb > 0 ? (k.rh + k.fg) / k.mb : 0)} small="de la marge absorbée" />
      <ul className="pj-parts">
        <li><i style={{ background: C.night }} />Part personnel <b>{pct1(k.mb > 0 ? k.rh / k.mb : 0)}</b> <span>{eur0(k.rh)}</span></li>
        <li><i style={{ background: C.slate }} />Part frais généraux <b>{pct1(k.mb > 0 ? k.fg / k.mb : 0)}</b> <span>{eur0(k.fg)}</span></li>
        <li><i style={{ background: C.gold }} />Part résultat d’exploitation <b>{pct1(k.mb > 0 ? res / k.mb : 0)}</b> <span>{eur0(res)}</span></li>
      </ul>
      {deficit ? <p className="pj-def-note" role="note">Déficit d’exploitation de {eur0(-res)} : la marge brute ne couvre pas le personnel et les frais généraux  (les parts sont rapportées à la marge brute).</p> : null}
    </figure>
  );
}

const PJ_CSS = `
.pj-be{background:var(--surface);border:1px solid var(--line);border-top:4px solid #D6AD00;border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.pj-be h2{margin:0;font-size:18px;color:#012735}
.pj-be-p{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}
.pj-be-p input{height:38px;width:160px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);padding:0 8px;font:inherit;font-size:14px;text-align:right}
.pj-be-p input:focus-visible{outline:2px solid #D6AD00;outline-offset:1px}
.pj-be-w{overflow:auto}
.pj-be-t{border-collapse:collapse;width:100%;font-size:13px}
.pj-be-t th,.pj-be-t td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pj-be-t th[scope=row]{text-align:left;white-space:normal;font-weight:600;min-width:240px}
.pj-be-t th small{display:block;font-weight:400;font-size:11px;color:var(--muted)}
.pj-be-t thead th{background:#012735;color:#fff;border-bottom:3px solid #D6AD00}
.pj-be-t tr.st th,.pj-be-t tr.st td{background:rgba(214,173,0,.14);font-weight:700}
.pj-be-t td.neg{color:#A22E22}

.pj-root{background:var(--bg);color:var(--ink);font-family:var(--font-body,'IBM Plex Sans',sans-serif);min-height:calc(100vh - 90px)}
.pj-main{max-width:1200px;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:16px}
.pj-back{color:#fff;text-decoration:none;font-size:14px;font-weight:600;border:1px solid rgba(255,255,255,.4);border-radius:6px;padding:6px 12px}
.pj-back:hover{background:rgba(255,255,255,.12)}
.pj-back:focus-visible{outline:2px solid #D6AD00;outline-offset:2px}
.pj-note{color:var(--muted);margin:0}
.pj-warn{margin:0;background:var(--bad-soft,#fbe9e7);color:var(--bad,#A22E22);border-radius:6px;padding:10px 12px;font-size:14px}
.pj-sel{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;background:var(--surface);border:1px solid var(--line);border-top:4px solid #D6AD00;border-radius:8px;padding:12px 14px}
.pj-f{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:var(--muted)}
.pj-f select{height:38px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);padding:0 8px;font:inherit;font-size:14px}
.pj-f select:focus-visible{outline:2px solid #D6AD00;outline-offset:1px}
.pj-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px}
.pj-kpi{background:var(--surface);border:1px solid var(--line);border-radius:8px;overflow:hidden;display:flex;flex-direction:column}
.pj-kpi header{background:#012735;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;border-bottom:3px solid #D6AD00}
.pj-kpi h3{margin:0;font-size:22px}
.pj-tag{font-size:12px;font-weight:700;background:rgba(255,255,255,.14);border-radius:999px;padding:3px 10px;text-align:right}
.pj-tag.lk{background:#D6AD00;color:#012735}
.pj-base{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0;padding:12px 14px;border-bottom:1px solid var(--line)}
.pj-base dt{font-size:11px;color:var(--muted)}
.pj-base dd{margin:2px 0 0;font-weight:700;font-size:15px;font-variant-numeric:tabular-nums}
.pj-base dd.neg{color:#A22E22}
.pj-ratio{padding:10px 14px;border-bottom:1px solid var(--line)}
.pj-ratio:last-child{border-bottom:0}
.pj-ratio.warn{background:rgba(214,173,0,.12)}
.pj-rl{font-size:12px;font-weight:600;color:var(--muted);margin-bottom:4px}
.pj-rv{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pj-rv span{display:flex;flex-direction:column}
.pj-rv b{font-size:20px;color:#012735;font-variant-numeric:tabular-nums}
.pj-rv small{font-size:11px;color:var(--muted)}
.pj-fx{padding:8px 14px 12px;font-size:12px;border-top:1px solid var(--line)}
.pj-fx summary{cursor:pointer;font-weight:600;color:#012735}
.pj-fx ul{list-style:none;margin:6px 0;padding:0;display:flex;flex-direction:column;gap:3px}
.pj-fx li{display:flex;justify-content:space-between;gap:10px}
.pj-fx li b{font-variant-numeric:tabular-nums;white-space:nowrap}
.pj-fx p{margin:4px 0 0;color:var(--muted)}
.pj-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
.pj-card{margin:0;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
.pj-card figcaption{font-weight:700;margin-bottom:8px;color:#012735}
.pj-donuts h2{margin:0 0 8px;font-size:18px;color:#012735}
.pj-dgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
.pj-parts{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:13px}
.pj-parts li{display:flex;align-items:center;gap:6px}
.pj-parts i{width:12px;height:12px;border-radius:3px;flex:none}
.pj-parts b{margin-left:auto;font-variant-numeric:tabular-nums}
.pj-parts span{color:var(--muted);font-size:12px;min-width:84px;text-align:right;font-variant-numeric:tabular-nums}
.pj-def-note{margin:8px 0 0;font-size:12px;background:var(--bad-soft,#fbe9e7);color:var(--bad,#A22E22);border-radius:4px;padding:6px 8px}
.pj-def{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:10px 14px;font-size:13px}
.pj-def summary{cursor:pointer;font-weight:600}
.pj-def li{margin:4px 0}
@media (max-width:520px){.pj-base{grid-template-columns:1fr 1fr 1fr}.pj-rv b{font-size:17px}}
`;
