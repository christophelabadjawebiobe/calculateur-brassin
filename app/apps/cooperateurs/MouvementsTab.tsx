'use client';
// app/apps/cooperateurs/MouvementsTab.tsx : onglet 3 « Mouvements & Parts » (prises de parts, remboursements et cessions)
import React, { useMemo, useState } from 'react';
import type { Cooperateur, Mouvement } from '@/lib/cooperateurs/types';
import { fmtDate, fmtMontant } from '@/lib/cooperateurs/numbers';
import { nomComplet, partsDe } from './data';
import { Modal } from './ui';
import type { TabProps } from './CooperateursApp';

type Ligne = Mouvement & { coop: Cooperateur };
const AUJOURD = () => new Date().toISOString().slice(0, 10);

export default function MouvementsTab({ store, reload, notify, supabase }: TabProps) {
  const { coops, valeurPart, canWrite } = store;
  const [q, setQ] = useState(''); const [annee, setAnnee] = useState('');
  // nature : prise = souscription (+), cession = retrait / remboursement (−)
  const [open, setOpen] = useState(false);
  const [rech, setRech] = useState(''); const [choix, setChoix] = useState<number | null>(null);
  const [nature, setNature] = useState<'prise' | 'cession'>('prise'); const [date, setDate] = useState(''); const [n, setN] = useState('1'); const [busy, setBusy] = useState(false);

  const lignes: Ligne[] = useMemo(() => {
    const l: Ligne[] = []; coops.forEach((c: Cooperateur) => (c.mouvements_parts || []).forEach((m: Mouvement) => l.push({ ...m, coop: c })));
    return l.sort((a, b) => (b.date_mouvement || '0000').localeCompare(a.date_mouvement || '0000') || b.id - a.id);
  }, [coops]);
  const annees = useMemo(() => [...new Set(lignes.map((l: Ligne) => (l.date_mouvement || '').slice(0, 4)).filter(Boolean))].sort().reverse(), [lignes]);
  const vue = lignes.filter((l: Ligne) => (!annee || (l.date_mouvement || '').startsWith(annee)) && (!q.trim() || (nomComplet(l.coop) + ' ' + (l.coop.certificat ?? '')).toLowerCase().includes(q.trim().toLowerCase())));
  const totalVue = vue.reduce((s: number, l: Ligne) => s + l.nombre_parts, 0);
  const propositions = rech.trim().length >= 2 ? coops.filter((c: Cooperateur) => (nomComplet(c) + ' ' + (c.certificat ?? '')).toLowerCase().includes(rech.trim().toLowerCase())).slice(0, 8) : [];
  const cc = choix != null ? coops.find((c: Cooperateur) => c.id === choix) || null : null;

  const ouvrir = () => { setRech(''); setChoix(null); setNature('prise'); setDate(AUJOURD()); setN('1'); setOpen(true); };
  /** nombre de parts SIGNÉ tel que saisi : positif = souscription, négatif = retrait / remboursement (jamais écrasé en valeur absolue) */
  const partsSignees = parseInt(n, 10) || 0;
  const onNombre = (v: string) => { setN(v); const x = parseInt(v, 10); if (x < 0) setNature('cession'); else if (x > 0) setNature('prise'); };
  const onNature = (v: 'prise' | 'cession') => { setNature(v); const x = Math.abs(parseInt(n, 10) || 0); setN(String(v === 'cession' ? -x : x)); };
  const soldeApres = cc ? partsDe(cc) + partsSignees : 0;
  const enregistrer = async () => {
    if (!cc) { notify('Choisissez un coopérateur', 'bad'); return; }
    if (!partsSignees) { notify('Indiquez un nombre de parts (positif : souscription, négatif : retrait)', 'bad'); return; }
    if (soldeApres < 0) { notify(`${nomComplet(cc)} ne détient que ${partsDe(cc)} part(s) : retrait de ${Math.abs(partsSignees)} impossible`, 'bad'); return; }
    setBusy(true);
    // RPC (sql/11) : applique le signe, contrôle le solde et trace l'opération au journal ; repli sur l'insertion directe si le script 11 n'est pas encore exécuté
    let r = await supabase.rpc('enregistrer_mouvement', { p_coop: cc.id, p_date: date || null, p_parts: partsSignees, p_montant: partsSignees * valeurPart });
    if (r.error && /enregistrer_mouvement|schema cache|does not exist/i.test(r.error.message || '')) {
      r = await supabase.from('mouvements_parts').insert({ cooperateur_id: cc.id, date_mouvement: date || null, nombre_parts: partsSignees, montant_total: partsSignees * valeurPart });
    }
    setBusy(false);
    if (r.error) { notify(r.error.message, 'bad'); return; }
    setOpen(false);
    notify(partsSignees < 0 ? `Retrait enregistré : ${partsSignees} part(s), solde ${soldeApres}` : `Souscription enregistrée : +${partsSignees} part(s), solde ${soldeApres}`, 'ok'); await reload();
  };

  return (
    <>
      <div className="co-bar">
        <input type="search" aria-label="Rechercher un mouvement" placeholder="Coopérateur ou n° de certificat…" value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} />
        <select aria-label="Année" value={annee} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAnnee(e.target.value)}><option value="">Toutes les années</option>{annees.map((a: string) => <option key={a}>{a}</option>)}</select>
        <button type="button" className="co-btn primary" disabled={!canWrite} onClick={ouvrir}>+ Nouveau mouvement</button>
        <span className="co-hint">{vue.length} mouvement{vue.length > 1 ? 's' : ''} · solde {totalVue} part{Math.abs(totalVue) > 1 ? 's' : ''} ({fmtMontant(totalVue * valeurPart)})</span>
      </div>
      <div className="co-wrap">
        <table className="co-tbl">
          <thead><tr><th>Date</th><th>Coopérateur</th><th className="n">N° cert.</th><th className="n">Parts</th><th className="n">Montant</th><th>Nature</th></tr></thead>
          <tbody>
            {vue.slice(0, 500).map((l: Ligne) => (
              <tr key={l.id}><td>{fmtDate(l.date_mouvement) || '—'}</td><td>{nomComplet(l.coop)}</td><td className="n">{l.coop.certificat ?? '—'}</td>
                <td className="n" style={{ color: l.nombre_parts < 0 ? 'var(--bad)' : undefined }}>{l.nombre_parts > 0 ? '+' : ''}{l.nombre_parts}</td><td className="n" style={{ color: l.nombre_parts < 0 ? 'var(--bad)' : undefined }}>{fmtMontant(l.montant_total ?? l.nombre_parts * valeurPart)}</td>
                <td>{l.nombre_parts < 0 ? <span className="co-chip bad">Retrait / remboursement</span> : l.demande_id ? <span className="co-chip gold">Souscription</span> : <span className="co-chip">Prise de parts</span>}</td></tr>))}
            {vue.length === 0 ? <tr><td colSpan={6} className="co-hint" style={{ padding: 18 }}>Aucun mouvement.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="co-hint">Un nombre négatif (ex. −2 parts = −500 €) correspond à un retrait, un remboursement ou une cession ; le solde du coopérateur est recalculé immédiatement. Les souscriptions du formulaire sont créées automatiquement par « Valider dans le registre ».</p>
      {open ? (
        <Modal title="Nouveau mouvement de parts" onClose={() => setOpen(false)}>
          <label className="co-f">Coopérateur
            <input value={cc ? nomComplet(cc) : rech} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setRech(e.target.value); setChoix(null); }} placeholder="Taper un nom ou un n° de certificat…" autoComplete="off" />
          </label>
          {!cc && propositions.length ? <div className="co-wrap" style={{ maxHeight: 180 }}><table className="co-tbl"><tbody>{propositions.map((c: Cooperateur) => <tr key={c.id} className="sel" tabIndex={0} onClick={() => setChoix(c.id)} onKeyDown={(e: React.KeyboardEvent<HTMLTableRowElement>) => { if (e.key === 'Enter') setChoix(c.id); }}><td>{nomComplet(c)}</td><td className="n">{c.certificat ?? '—'}</td><td className="n">{partsDe(c)} parts</td></tr>)}</tbody></table></div> : null}
          {cc ? <p className="co-hint">Actuellement {partsDe(cc)} part(s) ({fmtMontant(partsDe(cc) * valeurPart)}).</p> : null}
          <div className="co-grid">
            <label className="co-f">Type de mouvement<select value={nature} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onNature(e.target.value as 'prise' | 'cession')}><option value="prise">Souscription [+]</option><option value="cession">Retrait / remboursement [−]</option></select></label>
            <label className="co-f">Date<input type="date" value={date} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDate(e.target.value)} /></label>
            <label className="co-f">Nombre de parts (signé)<input type="number" step={1} value={n} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onNombre(e.target.value)} aria-describedby="mv-aide" /></label>
          </div>
          <p className="co-hint" id="mv-aide">Vous pouvez aussi saisir directement une valeur négative (ex. −2) : le type bascule sur « Retrait ».</p>
          <p className="co-hint" aria-live="polite">Montant : <b style={{ color: partsSignees < 0 ? 'var(--bad)' : undefined }}>{fmtMontant(partsSignees * valeurPart)}</b>{cc ? <> · solde après opération : <b style={{ color: soldeApres < 0 ? 'var(--bad)' : undefined }}>{soldeApres} part(s)</b> ({fmtMontant(soldeApres * valeurPart)})</> : null}</p>
          <div className="co-acts" style={{ justifyContent: 'flex-end' }}><button type="button" className="co-btn" onClick={() => setOpen(false)}>Annuler</button><button type="button" className="co-btn gold" disabled={busy || !cc || !partsSignees || soldeApres < 0} onClick={enregistrer}>Enregistrer</button></div>
        </Modal>
      ) : null}
    </>
  );
}
