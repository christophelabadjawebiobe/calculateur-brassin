'use client';
// app/apps/cooperateurs/StatsTab.tsx : onglet 4 « Statistiques, AG & Valorisation »
//   KPI, répartition par classe, feuille de présence AG (impression / PDF, CSV) et valeur comptable d'une part (formule de Sam)
import React, { useMemo, useState } from 'react';
import type { Cooperateur, Valorisation } from '@/lib/cooperateurs/types';
import { fmtDate, fmtDateLong, fmtMontant, fmtNombre } from '@/lib/cooperateurs/numbers';
import { nomComplet, partsDe } from './data';
import { lignesRegistre, pctCapital, telechargerCsv, versCsv } from '@/lib/cooperateurs/export';
import { echapper, ouvrirImpression } from './ui';
import AnnuaireCompetences, { AN_CSS } from './AnnuaireCompetences';
import type { TabProps } from './CooperateursApp';

const AUJOURD = () => new Date().toISOString().slice(0, 10);
const num = (s: string): number => { const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(v) ? v : 0; };
const pct = (x: number): string => (Math.round(x * 1000) / 10).toString().replace('.', ',') + ' %';
const partsAu = (c: Cooperateur, date: string): number => (c.mouvements_parts || []).filter((m) => !m.date_mouvement || m.date_mouvement <= date).reduce((s: number, m) => s + m.nombre_parts, 0);
function telecharger(nom: string, contenu: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + contenu], { type: 'text/csv;charset=utf-8' })); a.download = nom; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const csvCell = (v: unknown): string => { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

export default function StatsTab({ store, reload, notify, supabase }: TabProps) {
  const { coops, demandes, valos, valeurPart, canWrite } = store;
  const masque = Boolean(store.demo || store.anonymise);   // données masquées : ni feuille d'émargement nominative, ni export en clair, ni annuaire
  const actifs = coops.filter((c: Cooperateur) => partsDe(c) > 0);
  const totalParts = actifs.reduce((s: number, c: Cooperateur) => s + partsDe(c), 0);
  const parClasse = useMemo(() => {
    const m = new Map<string, { n: number; parts: number }>();
    actifs.forEach((c: Cooperateur) => { const k = c.categories ? c.categories.code : '—'; const x = m.get(k) || { n: 0, parts: 0 }; x.n++; x.parts += partsDe(c); m.set(k, x); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [actifs]);
  const enCours = demandes.filter((d) => !d.valide_registre).length;

  /* ---- feuille de présence AG ---- */
  const [dateAg, setDateAg] = useState(AUJOURD());
  const presents = useMemo(() => coops.map((c: Cooperateur) => ({ c, p: partsAu(c, dateAg) })).filter((x) => x.p > 0).sort((a, b) => a.c.nom.localeCompare(b.c.nom, 'fr') || (a.c.prenom || '').localeCompare(b.c.prenom || '', 'fr')), [coops, dateAg]);
  const totalAg = useMemo(() => presents.reduce((s: number, x) => s + x.p, 0), [presents]);
  const exporter = (anonyme: boolean) => {
    const x = lignesRegistre(coops, valeurPart, { anonyme, date: dateAg }).lignes;
    const e = lignesRegistre(coops, valeurPart, { anonyme, date: dateAg }).entetes;
    const garde = (r: (string | number)[]) => Number(r[e.indexOf('Parts')]) > 0;
    telechargerCsv(`registre-${anonyme ? 'anonymise-' : ''}${dateAg}.csv`, versCsv(e, x.filter(garde)));
    notify(anonyme ? 'Export anonymisé téléchargé (situation au ' + fmtDate(dateAg) + ')' : 'Export du registre téléchargé (situation au ' + fmtDate(dateAg) + ', données en clair)', anonyme ? 'ok' : 'info');
  };
  const imprimerAg = () => {
    const lignes = presents.map((x, i: number) => `<tr><td class="n">${i + 1}</td><td class="n">${x.c.certificat ?? ''}</td><td>${echapper(x.c.nom)}</td><td>${echapper(x.c.prenom || (x.c.representant ? 'rep. ' + x.c.representant : ''))}</td><td>${echapper(x.c.categories ? x.c.categories.code : '')}</td><td class="n">${x.p}</td><td class="n">${pctCapital(x.p, totalAg)}</td><td class="sig"></td><td></td></tr>`).join('');
    const ok = ouvrirImpression('Feuille de présence AG', `<h1>Assemblée générale du ${fmtDateLong(dateAg)} : feuille de présence</h1><p>Brasserie coopérative liégeoise SCRL FS · ${presents.length} coopérateurs · ${fmtNombre(presents.reduce((s: number, x) => s + x.p, 0))} parts</p>
      <table><thead><tr><th>#</th><th>N° cert.</th><th>Nom</th><th>Prénom / représentant</th><th>Classe</th><th>Parts</th><th>% du capital</th><th>Signature</th><th>Procuration (nom du mandataire)</th></tr></thead><tbody>${lignes}</tbody></table>`);
    if (!ok) notify('Le navigateur a bloqué la fenêtre d’impression : autorisez les fenêtres surgissantes pour ce site', 'bad');
  };
  const csvAg = () => telecharger(`presence-ag-${dateAg}.csv`, ['N° certificat;Nom;Prénom;Représentant;Classe;Parts;% du capital;Signature', ...presents.map((x) => [x.c.certificat ?? '', x.c.nom, x.c.prenom || '', x.c.representant || '', x.c.categories ? x.c.categories.code : '', x.p, pctCapital(x.p, totalAg), ''].map(csvCell).join(';'))].join('\r\n'));

  /* ---- valeur comptable d'une part ---- */
  const [v, setV] = useState({ date: AUJOURD().slice(0, 4) + '-12-31', nl: '0', res: '0', rep: '0', exo: '0', sub: '0', capManuel: '', rem: '' });
  const parts = useMemo(() => coops.reduce((s: number, c: Cooperateur) => s + partsAu(c, v.date), 0), [coops, v.date]);
  const capital = v.capManuel !== '' ? num(v.capManuel) : parts * valeurPart;
  const cp = capital - num(v.nl) + num(v.res) + num(v.rep) + num(v.exo) + num(v.sub);
  const val = parts > 0 ? cp / parts : 0;
  const [busy, setBusy] = useState(false);
  const setf = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const avert = parts <= 0 ? 'Aucune part en circulation à cette date.' : cp < 0 ? 'Capitaux propres négatifs : valeur comptable négative.' : Math.abs(capital - parts * valeurPart) > 0.5 && v.capManuel !== '' ? 'Le capital saisi diffère du registre (parts × valeur nominale).' : '';
  const enregistrer = async () => {
    if (parts <= 0) { notify('Aucune part en circulation à cette date', 'bad'); return; }
    setBusy(true);
    const r = await supabase.from('valorisations_annuelles').upsert({
      date_cloture: v.date, nombre_parts: parts, valeur_nominale: valeurPart, capital, capital_non_libere: num(v.nl), reserves: num(v.res), resultat_reporte: num(v.rep), resultat_exercice: num(v.exo), subsides_capital: num(v.sub),
      capitaux_propres: Math.round(cp * 100) / 100, valeur_comptable_part: Math.round(val * 10000) / 10000, remarque: v.rem.trim() || null, calcule_le: new Date().toISOString(),
    }, { onConflict: 'date_cloture' });
    setBusy(false);
    if (r.error) { notify(r.error.message, 'bad'); return; }
    notify('Calcul enregistré (tracé dans le journal d’audit)', 'ok'); await reload();
  };
  const recharger = (x: Valorisation) => setV({ date: x.date_cloture, nl: String(x.capital_non_libere), res: String(x.reserves), rep: String(x.resultat_reporte), exo: String(x.resultat_exercice), sub: String(x.subsides_capital), capManuel: String(x.capital), rem: x.remarque || '' });
  const csvHisto = () => telecharger('valorisations-annuelles.csv', ['Clôture;Parts;Capital;Capital non libéré;Réserves;Résultat reporté;Résultat exercice;Subsides;Capitaux propres;Valeur par part;Remarque', ...valos.map((x: Valorisation) => [x.date_cloture, x.nombre_parts, x.capital, x.capital_non_libere, x.reserves, x.resultat_reporte, x.resultat_exercice, x.subsides_capital, x.capitaux_propres, x.valeur_comptable_part, x.remarque || ''].map(csvCell).join(';'))].join('\r\n'));

  return (
    <>
      <div className="co-kpis">
        <div className="co-kpi"><b>{actifs.length}</b><span>coopérateurs actifs</span></div>
        <div className="co-kpi"><b>{fmtNombre(totalParts)}</b><span>parts en circulation</span></div>
        <div className="co-kpi"><b>{fmtMontant(totalParts * valeurPart)}</b><span>capital souscrit (parts de {fmtMontant(valeurPart)})</span></div>
        <div className="co-kpi"><b>{enCours}</b><span>souscriptions à traiter</span></div>
      </div>
      <div className="co-card">
        <h2>Répartition par classe</h2>
        <div className="co-wrap" style={{ maxHeight: 220 }}><table className="co-tbl"><thead><tr><th>Classe</th><th className="n">Coopérateurs</th><th className="n">Parts</th><th className="n">Capital</th><th className="n">% du capital</th></tr></thead><tbody>
          {parClasse.map(([k, x]) => <tr key={k}><td>{k}{(store.categories.find((c) => c.code === k) || { libelle: '' }).libelle ? ' — ' + (store.categories.find((c) => c.code === k) || { libelle: '' }).libelle : ''}</td><td className="n">{x.n}</td><td className="n">{fmtNombre(x.parts)}</td><td className="n">{fmtMontant(x.parts * valeurPart)}</td><td className="n">{pctCapital(x.parts, totalParts)}</td></tr>)}
          {parClasse.length === 0 ? <tr><td colSpan={5} className="co-hint">Aucun coopérateur actif.</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="co-card">
        <h2>Assemblée générale : feuille de présence</h2>
        <div className="co-bar">
          <label className="co-f" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>Date de l’AG<input type="date" value={dateAg} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDateAg(e.target.value)} /></label>
          {masque ? null : <button type="button" className="co-btn gold" onClick={imprimerAg} disabled={!presents.length}>📋 Feuille de présence AG</button>}
          {masque ? null : <button type="button" className="co-btn" onClick={csvAg} disabled={!presents.length}>⭳ CSV (émargement)</button>}
          <button type="button" className="co-btn" onClick={() => exporter(true)} disabled={!presents.length} title="CSV compatible Excel : noms, e-mails, téléphones et numéros masqués">📥 Exporter le Registre (Anonymisé)</button>
          {masque ? null : <button type="button" className="co-btn ghost" onClick={() => exporter(false)} disabled={!presents.length}>📥 Export standard</button>}
          <span className="co-hint">{presents.length} coopérateur{presents.length > 1 ? 's' : ''} détenant des parts au {fmtDate(dateAg)} · « Enregistrer en PDF » dans la boîte d’impression</span>
        </div>
      </div>

      <div className="co-card" id="valorisation">
        <h2>Valeur comptable d’une part sociale <span className="co-hint">(calcul annuel)</span></h2>
        <p className="co-hint">Valeur par part = capitaux propres ÷ parts en circulation à la clôture. Capitaux propres = capital − capital non libéré + réserves + résultat reporté + résultat de l’exercice + subsides en capital. Montants à reprendre du bilan approuvé (à valider avec le comptable).</p>
        <div className="co-grid" style={{ marginTop: 8 }}>
          <label className="co-f">Date de clôture<input type="date" value={v.date} onChange={setf('date')} /></label>
          <label className="co-f">Parts en circulation <small>(registre)</small><input readOnly value={fmtNombre(parts)} /></label>
          <label className="co-f">Capital (€) <small>registre : {fmtMontant(parts * valeurPart)}</small><input inputMode="decimal" value={v.capManuel !== '' ? v.capManuel : String(parts * valeurPart)} onChange={setf('capManuel')} /></label>
          <label className="co-f">Capital non libéré à déduire (€)<input inputMode="decimal" value={v.nl} onChange={setf('nl')} /></label>
          <label className="co-f">Réserves (€) <small>légale + indisponibles + disponibles</small><input inputMode="decimal" value={v.res} onChange={setf('res')} /></label>
          <label className="co-f">Résultat reporté (€) <small>perte = négatif</small><input inputMode="decimal" value={v.rep} onChange={setf('rep')} /></label>
          <label className="co-f">Résultat de l’exercice (€) <small>perte = négatif</small><input inputMode="decimal" value={v.exo} onChange={setf('exo')} /></label>
          <label className="co-f">Subsides en capital (€)<input inputMode="decimal" value={v.sub} onChange={setf('sub')} /></label>
          <label className="co-f" style={{ gridColumn: '1 / -1' }}>Remarque<input value={v.rem} onChange={setf('rem')} placeholder="ex. comptes approuvés en AG du …" /></label>
        </div>
        <div className="co-kpis" style={{ margin: '10px 0' }}>
          <div className="co-kpi"><b>{fmtMontant(cp, 2)}</b><span>capitaux propres</span></div>
          <div className="co-kpi"><b>{parts > 0 ? fmtMontant(val, 2) : '—'}</b><span>valeur comptable par part</span></div>
          <div className="co-kpi"><b>{parts > 0 ? pct(val / valeurPart) : '—'}</b><span>par rapport à la valeur nominale</span></div>
        </div>
        {avert ? <p className="co-msg info">{avert}</p> : null}
        <div className="co-acts" style={{ margin: '8px 0' }}>
          <button type="button" className="co-btn primary" disabled={!canWrite || busy || parts <= 0} onClick={enregistrer}>Enregistrer le calcul</button>
          <button type="button" className="co-btn" onClick={() => setV((x) => ({ ...x, capManuel: '' }))}>Capital d’après le registre</button>
          <button type="button" className="co-btn" onClick={csvHisto} disabled={!valos.length}>Historique en CSV</button>
        </div>
        <div className="co-wrap" style={{ maxHeight: 240 }}><table className="co-tbl"><thead><tr><th>Clôture</th><th className="n">Parts</th><th className="n">Capitaux propres</th><th className="n">Valeur / part</th><th>Calculé le</th><th>Remarque</th></tr></thead><tbody>
          {valos.map((x: Valorisation) => <tr key={x.id} className="sel" tabIndex={0} onClick={() => recharger(x)} onKeyDown={(e: React.KeyboardEvent<HTMLTableRowElement>) => { if (e.key === 'Enter') recharger(x); }}>
            <td>{fmtDate(x.date_cloture)}</td><td className="n">{fmtNombre(x.nombre_parts)}</td><td className="n">{fmtMontant(Number(x.capitaux_propres), 2)}</td><td className="n">{fmtMontant(Number(x.valeur_comptable_part), 2)}</td><td>{fmtDate(x.calcule_le)}</td><td>{x.remarque || ''}</td></tr>)}
          {valos.length === 0 ? <tr><td colSpan={6} className="co-hint">Aucun calcul enregistré.</td></tr> : null}
        </tbody></table></div>
        <p className="co-hint">Cliquez sur une ligne pour la recharger ; enregistrer avec la même date de clôture la remplace (l’ancienne version reste dans le journal d’audit).</p>
      </div>

      <style>{AN_CSS}</style>
      {masque ? null : <AnnuaireCompetences coops={coops} notify={notify} />}
    </>
  );
}
