'use client';
// app/apps/cooperateurs/DoublonsTab.tsx : onglet 5 « Doublons & Foyers » (repris du travail de Sam : groupes_doublons, fusion contrôlée)
//   détection (même e-mail / téléphone / nom / adresse) → groupes à traiter → fusion des fiches (parts, coordonnées, historique au journal d'audit)
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Adresse, Contact, Cooperateur, Mouvement } from '@/lib/cooperateurs/types';
import { fmtDate, fmtNombre } from '@/lib/cooperateurs/numbers';
import { emailDe, nomComplet, partsDe, telDe, villeDe } from './data';
import { Modal } from './ui';
import type { TabProps } from './CooperateursApp';

type Groupe = { id: number; type: string; raisons: string | null; score: number; statut: 'a_traiter' | 'traite' | 'ignore'; membres: number[] };
const STATUT: Record<string, string> = { traite: 'traité', ignore: 'écarté' };
const cle = (...v: (string | null | undefined)[]): string => v.map((x) => (x || '').toLowerCase().trim()).join('|');

export default function DoublonsTab({ store, reload, notify, supabase }: TabProps) {
  const { coops, categories, canWrite } = store;
  const [groupes, setGroupes] = useState<Groupe[] | null>(null);
  const [erreur, setErreur] = useState('');
  const [fait, setFait] = useState(false);
  const [busy, setBusy] = useState('');
  const [mg, setMg] = useState<Groupe | null>(null);

  const charger = useCallback(async () => {
    const r = await supabase.from('groupes_doublons').select('id,type,raisons,score,statut,groupes_doublons_membres(cooperateur_id)').order('id');
    if (r.error) { setErreur(/relation|does not exist|schema cache/i.test(r.error.message || '') ? 'Les tables des doublons n’existent pas encore : exécutez la dernière version de sql/07_cooperateurs.sql.' : r.error.message); setGroupes([]); return; }
    setErreur('');
    setGroupes((r.data || []).map((g: any) => ({ id: g.id, type: g.type, raisons: g.raisons, score: g.score, statut: g.statut, membres: (g.groupes_doublons_membres || []).map((m: any) => m.cooperateur_id) })));
  }, [supabase]);
  useEffect(() => { charger(); }, [charger, coops]);

  const parId = useMemo(() => { const m = new Map<number, Cooperateur>(); coops.forEach((c: Cooperateur) => m.set(c.id, c)); return m; }, [coops]);
  const liste = useMemo(() => (groupes || []).filter((g: Groupe) => (fait || g.statut === 'a_traiter') && g.membres.filter((i: number) => parId.has(i)).length >= 2)
    .sort((a: Groupe, b: Groupe) => (a.type === 'doublon probable' ? 0 : 1) - (b.type === 'doublon probable' ? 0 : 1) || b.score - a.score || a.id - b.id), [groupes, fait, parId]);
  const aTraiter = (groupes || []).filter((g: Groupe) => g.statut === 'a_traiter').length;

  const detecter = async () => {
    setBusy('det');
    const r = await supabase.rpc('detecter_doublons');
    setBusy('');
    if (r.error) { notify(r.error.message, 'bad'); return; }
    const d = r.data || {}; notify(`Détection terminée : ${d.a_traiter ?? 0} groupe(s) à traiter (${d.nouveaux ?? 0} nouveau(x))`, 'ok'); await charger();
  };
  const statut = async (g: Groupe, s: 'a_traiter' | 'ignore') => {
    setBusy('s' + g.id);
    const r = await supabase.rpc('statut_groupe_doublons', { p_groupe: g.id, p_statut: s });
    setBusy('');
    if (r.error) { notify(r.error.message, 'bad'); return; }
    notify(s === 'ignore' ? 'Groupe écarté : ce ne sont pas des doublons' : 'Groupe rouvert', 'ok'); await charger();
  };

  return (
    <>
      <div className="co-bar">
        <button type="button" className="co-btn primary" onClick={detecter} disabled={!canWrite || busy === 'det'}>🔍 Détecter les doublons</button>
        <label className="co-hint" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={fait} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFait(e.target.checked)} /> Afficher les groupes traités / écartés</label>
        <span className="co-hint">{groupes === null ? 'Chargement…' : `${aTraiter} groupe${aTraiter > 1 ? 's' : ''} à traiter`}</span>
      </div>
      <p className="co-hint">Groupes détectés sur le même e-mail, le même téléphone, le même nom ou la même adresse. « Doublon probable » : une même personne inscrite deux fois ; « Foyer possible » : personnes distinctes vivant à la même adresse (à ne fusionner que si c’est bien la même personne).</p>
      {erreur ? <p className="co-msg bad" role="alert">{erreur}</p> : null}
      {groupes !== null && !erreur && liste.length === 0 ? <p className="co-msg info">{aTraiter === 0 ? 'Aucun doublon à traiter 🎉 (lancez « Détecter les doublons » après chaque import important).' : 'Aucun groupe à afficher.'}</p> : null}
      {liste.map((g: Groupe) => {
        const todo = g.statut === 'a_traiter';
        const fiches = g.membres.map((i: number) => parId.get(i)).filter((c): c is Cooperateur => Boolean(c));
        return (
          <section key={g.id} className="co-card" aria-label={`Groupe ${g.id}`}>
            <h2 style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {g.type === 'doublon probable' ? 'Doublon probable' : 'Foyer possible'}
              <span className={'co-chip ' + (g.type === 'doublon probable' ? 'warn' : '')}>score {g.score}</span>
              {!todo ? <span className="co-chip ok">{STATUT[g.statut]}</span> : null}
            </h2>
            <p className="co-hint">{g.raisons}</p>
            <div className="co-wrap" style={{ maxHeight: 260 }}>
              <table className="co-tbl"><thead><tr><th className="n">N°</th><th>Coopérateur</th><th>Classe</th><th className="n">Parts</th><th>E-mail</th><th>Téléphone</th><th>Commune</th></tr></thead><tbody>
                {fiches.map((c: Cooperateur) => <tr key={c.id}><td className="n">{c.certificat ?? '—'}</td><td><b>{nomComplet(c)}</b></td><td><span className="co-chip">{c.categories ? c.categories.code : '—'}</span></td><td className="n">{partsDe(c)}</td><td>{emailDe(c)}</td><td>{telDe(c)}</td><td>{villeDe(c)}</td></tr>)}
              </tbody></table>
            </div>
            <div className="co-acts" style={{ marginTop: 8 }}>
              {todo ? <button type="button" className="co-btn gold" disabled={!canWrite} onClick={() => setMg(g)}>Fusionner les fiches…</button> : null}
              {todo ? <button type="button" className="co-btn" disabled={!canWrite || busy === 's' + g.id} onClick={() => statut(g, 'ignore')}>Ce ne sont pas des doublons</button> : null}
              {g.statut === 'ignore' ? <button type="button" className="co-btn" disabled={!canWrite || busy === 's' + g.id} onClick={() => statut(g, 'a_traiter')}>Rouvrir le groupe</button> : null}
            </div>
          </section>
        );
      })}
      {mg ? <Fusion groupe={mg} fiches={mg.membres.map((i: number) => parId.get(i)).filter((c): c is Cooperateur => Boolean(c))} categories={categories} supabase={supabase} notify={notify}
        onClose={() => setMg(null)} onDone={async () => { setMg(null); await reload(); await charger(); }} /> : null}
    </>
  );
}

function Fusion({ groupe, fiches, categories, supabase, notify, onClose, onDone }: { groupe: Groupe; fiches: Cooperateur[]; categories: TabProps['store']['categories']; supabase: any; notify: TabProps['notify']; onClose: () => void; onDone: () => Promise<void> }) {
  // fiche conservée par défaut : celle qui a un certificat, puis le plus de parts
  const ordre = useMemo(() => fiches.slice().sort((a: Cooperateur, b: Cooperateur) => Number(b.certificat != null) - Number(a.certificat != null) || partsDe(b) - partsDe(a) || a.id - b.id), [fiches]);
  const [garde, setGarde] = useState<number>(ordre[0].id);
  const [absorbe, setAbsorbe] = useState<Set<number>>(() => new Set(ordre.slice(1).map((c: Cooperateur) => c.id)));
  const [busy, setBusy] = useState(false);
  const impliquees = useMemo(() => ordre.filter((c: Cooperateur) => c.id === garde || absorbe.has(c.id)), [ordre, garde, absorbe]);

  // lignes à conserver (doublons exacts décochés par défaut, comme chez Sam) : calculées sur l'ensemble des fiches du groupe
  const defauts = useMemo(() => {
    const mv = new Set<number>(), ad = new Set<number>(), ct = new Set<number>(); const vm = new Set<string>(), va = new Set<string>(), vc = new Set<string>();
    ordre.forEach((c: Cooperateur) => {
      (c.mouvements_parts || []).forEach((m: Mouvement) => { const k = (m.date_mouvement || '') + '|' + m.nombre_parts; if (!vm.has(k)) { vm.add(k); mv.add(m.id); } });
      (c.adresses || []).forEach((a: Adresse) => { const k = cle(a.rue, a.numero, a.code_postal, a.ville); if (!va.has(k)) { va.add(k); ad.add(a.id); } });
      (c.contacts || []).forEach((x: Contact) => { const k = x.type + '|' + x.valeur.toLowerCase().trim(); if (!vc.has(k)) { vc.add(k); ct.add(x.id); } });
    });
    return { mv, ad, ct };
  }, [ordre]);
  const [selMv, setSelMv] = useState<Set<number>>(defauts.mv); const [selAd, setSelAd] = useState<Set<number>>(defauts.ad); const [selCt, setSelCt] = useState<Set<number>>(defauts.ct);

  const choisir = (k: 'nom' | 'prenom' | 'representant' | 'numero_identification' | 'remarques'): string => {
    const g = ordre.find((c: Cooperateur) => c.id === garde) as Cooperateur;
    const own = g[k]; if (own) return String(own);
    const o = impliquees.find((c: Cooperateur) => c[k]); return o ? String(o[k]) : '';
  };
  const initId = () => {
    const g = ordre.find((c: Cooperateur) => c.id === garde) as Cooperateur;
    const rem = Array.from(new Set(impliquees.map((c: Cooperateur) => c.remarques).filter((x): x is string => Boolean(x)))).join(' ; ');
    const autreCert = impliquees.find((c: Cooperateur) => c.certificat != null);
    const cert = g.certificat != null ? g.certificat : autreCert ? autreCert.certificat : null;
    return { certificat: cert != null ? String(cert) : '', nom: choisir('nom'), prenom: choisir('prenom'), representant: choisir('representant'),
      numero_identification: choisir('numero_identification'), categorie_id: g.categorie_id ? String(g.categorie_id) : '', remarques: rem };
  };
  const [id, setId] = useState(initId);
  const changerGarde = (v: number) => {
    setGarde(v); setAbsorbe(new Set(ordre.filter((c: Cooperateur) => c.id !== v).map((c: Cooperateur) => c.id)));
  };
  useEffect(() => { setId(initId()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [garde]);
  const bascule = (set: Set<number>, setter: (s: Set<number>) => void, i: number) => { const n = new Set(set); if (n.has(i)) n.delete(i); else n.add(i); setter(n); };
  const setI = (k: keyof typeof id) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setId((x) => ({ ...x, [k]: e.target.value }));

  const fusionner = async () => {
    if (!id.nom.trim()) { notify('Le nom est obligatoire', 'bad'); return; }
    const abs = impliquees.filter((c: Cooperateur) => c.id !== garde).map((c: Cooperateur) => c.id);
    if (!abs.length) { notify('Cochez au moins une fiche à fusionner dans la fiche conservée', 'bad'); return; }
    const mv: number[] = [], ad: number[] = [], ct: number[] = [];
    impliquees.forEach((c: Cooperateur) => { (c.mouvements_parts || []).forEach((m: Mouvement) => { if (selMv.has(m.id)) mv.push(m.id); }); (c.adresses || []).forEach((a: Adresse) => { if (selAd.has(a.id)) ad.push(a.id); }); (c.contacts || []).forEach((x: Contact) => { if (selCt.has(x.id)) ct.push(x.id); }); });
    const perdues = impliquees.reduce((s: number, c: Cooperateur) => s + (c.mouvements_parts || []).filter((m: Mouvement) => !selMv.has(m.id)).reduce((t: number, m: Mouvement) => t + m.nombre_parts, 0), 0);
    if (!window.confirm(`Fusionner ${abs.length} fiche${abs.length > 1 ? 's' : ''} dans « ${nomComplet(ordre.find((c: Cooperateur) => c.id === garde) as Cooperateur)} » ?\n\n${perdues !== 0 ? `Attention : ${perdues} part(s) de lignes décochées seront supprimées du registre.\n\n` : ''}Les fiches absorbées sont supprimées ; leur contenu complet reste consultable dans le journal d’audit.`)) return;
    setBusy(true);
    const r = await supabase.rpc('fusionner_cooperateurs', {
      p_groupe: groupe.id, p_garder: garde, p_absorber: abs, p_mouvements: mv, p_adresses: ad, p_contacts: ct,
      p_identite: { certificat: id.certificat.trim(), nom: id.nom.trim(), prenom: id.prenom.trim(), representant: id.representant.trim(), numero_identification: id.numero_identification.replace(/\D/g, ''), categorie_id: id.categorie_id, remarques: id.remarques.trim() },
    });
    setBusy(false);
    if (r.error) { notify(/duplicate|unique/i.test(r.error.message) ? 'Ce numéro de certificat est déjà utilisé par une autre fiche' : r.error.message, 'bad'); return; }
    notify(`Fiches fusionnées (${abs.length} absorbée${abs.length > 1 ? 's' : ''}) : historique conservé dans le journal d’audit`, 'ok'); await onDone();
  };

  const lib = (c: Cooperateur) => nomComplet(c) + (c.certificat != null ? ' · cert. ' + c.certificat : ' · sans certificat');
  return (
    <Modal title={`Fusionner les fiches du groupe ${groupe.id}`} onClose={onClose} wide>
      <fieldset className="co-fs"><legend>Fiche conservée</legend>
        {ordre.map((c: Cooperateur) => <label key={c.id} className="co-chk"><input type="radio" name="garde" checked={garde === c.id} onChange={() => changerGarde(c.id)} /> <b>{nomComplet(c)}</b> — {c.certificat != null ? 'cert. ' + c.certificat : 'sans certificat'} — {fmtNombre(partsDe(c))} parts</label>)}
      </fieldset>
      <fieldset className="co-fs"><legend>Fiches à absorber (puis supprimées)</legend>
        {ordre.filter((c: Cooperateur) => c.id !== garde).map((c: Cooperateur) => <label key={c.id} className="co-chk"><input type="checkbox" checked={absorbe.has(c.id)} onChange={() => bascule(absorbe, setAbsorbe, c.id)} /> {lib(c)}</label>)}
        <span className="co-hint">Décochez une fiche qui n’est pas la même personne (foyer) : elle restera intacte.</span>
      </fieldset>
      <fieldset className="co-fs"><legend>Identité finale</legend>
        <div className="co-grid">
          <label className="co-f">N° certificat<input type="number" value={id.certificat} onChange={setI('certificat')} list="dl-cert" /><datalist id="dl-cert">{impliquees.filter((c: Cooperateur) => c.certificat != null).map((c: Cooperateur) => <option key={c.id} value={c.certificat as number} />)}</datalist></label>
          <label className="co-f">Nom / raison sociale<input value={id.nom} onChange={setI('nom')} /></label>
          <label className="co-f">Prénom<input value={id.prenom} onChange={setI('prenom')} /></label>
          <label className="co-f">Représentant<input value={id.representant} onChange={setI('representant')} /></label>
          <label className="co-f">N° national / d’entreprise<input value={id.numero_identification} onChange={setI('numero_identification')} /></label>
          <label className="co-f">Classe de parts<select value={id.categorie_id} onChange={setI('categorie_id')}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.libelle}</option>)}</select></label>
          <label className="co-f">Remarques<textarea rows={2} value={id.remarques} onChange={setI('remarques')} /></label>
        </div>
      </fieldset>
      <fieldset className="co-fs"><legend>Prises de parts à conserver</legend>
        {impliquees.map((c: Cooperateur) => (c.mouvements_parts || []).slice().sort((a: Mouvement, b: Mouvement) => (a.date_mouvement || '').localeCompare(b.date_mouvement || '') || a.id - b.id).map((m: Mouvement) =>
          <label key={m.id} className="co-chk"><input type="checkbox" checked={selMv.has(m.id)} onChange={() => bascule(selMv, setSelMv, m.id)} /> {nomComplet(c)} — {m.date_mouvement ? fmtDate(m.date_mouvement) : 'date inconnue'} — <b>{m.nombre_parts > 0 ? '+' : ''}{m.nombre_parts}</b> part(s)</label>))}
        <span className="co-hint">Les lignes identiques (même date, même nombre) à une ligne déjà retenue sont décochées : elles viennent peut-être d’une même saisie faite deux fois.</span>
      </fieldset>
      <fieldset className="co-fs"><legend>Adresses et contacts à conserver</legend>
        {impliquees.map((c: Cooperateur) => (c.adresses || []).map((a: Adresse) => <label key={'a' + a.id} className="co-chk"><input type="checkbox" checked={selAd.has(a.id)} onChange={() => bascule(selAd, setSelAd, a.id)} /> {[a.rue, a.numero, a.code_postal, a.ville].filter(Boolean).join(' ') || '(adresse vide)'} <span className="co-hint">({a.type} · {c.nom})</span></label>))}
        {impliquees.map((c: Cooperateur) => (c.contacts || []).map((x: Contact) => <label key={'c' + x.id} className="co-chk"><input type="checkbox" checked={selCt.has(x.id)} onChange={() => bascule(selCt, setSelCt, x.id)} /> {x.type === 'email' ? '✉' : '☎'} {x.valeur} <span className="co-hint">({c.nom})</span></label>))}
      </fieldset>
      <div className="co-acts"><span style={{ flex: 1 }} />
        <button type="button" className="co-btn" onClick={onClose}>Annuler</button>
        <button type="button" className="co-btn gold" onClick={fusionner} disabled={busy}>Fusionner les fiches</button>
      </div>
    </Modal>
  );
}
