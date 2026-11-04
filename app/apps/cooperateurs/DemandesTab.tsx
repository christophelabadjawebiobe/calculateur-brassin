'use client';
// app/apps/cooperateurs/DemandesTab.tsx : onglet 1 « Souscriptions & Demandes » (workflow : import → Odoo Sign → paiement → registre → certificat)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Demande } from '@/lib/cooperateurs/types';
import { fmtDate, fmtDateHeure, fmtMontant, fmtNumero } from '@/lib/cooperateurs/numbers';
import { appelApi, prochainCertificat } from './data';
import { CopyBadge, Modal } from './ui';
import type { TabProps } from './CooperateursApp';

type Filtre = 'traiter' | 'validees' | 'toutes';
const SIGN_LABEL: Record<string, string> = { a_envoyer: 'À envoyer', envoye: 'Envoyé', signe: 'Signé' };
const SIGN_CLASS: Record<string, string> = { a_envoyer: '', envoye: 'warn', signe: 'ok' };
const isSim = (id: string | null) => Boolean(id && id.startsWith('SIM-'));

export default function DemandesTab({ store, reload, notify, supabase }: TabProps) {
  const { demandes, coops, canWrite, isAdmin, valeurPart } = store;
  const [filtre, setFiltre] = useState<Filtre>('traiter');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string>('');
  const [conf, setConf] = useState<Demande | null>(null);          // modale de validation dans le registre
  const [datePaie, setDatePaie] = useState('');
  const [unlock, setUnlock] = useState<Demande | null>(null);      // modale de déverrouillage (admin)
  const [motif, setMotif] = useState('');
  const [civ, setCiv] = useState<Record<string, string>>({});
  const [cfg, setCfg] = useState<{ google: boolean; odoo: boolean; brevo: boolean } | null>(null);
  const [demo, setDemo] = useState<string>('');
  const [diag, setDiag] = useState<{ service: string; configure: boolean; ok: boolean; etapes: { ok: boolean; libelle: string; detail?: string }[]; aide: string[] }[] | 'charge' | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { let ok = true; fetch('/api/cooperateurs/google-sheet', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => { if (ok && j && j.ok) setCfg({ google: j.google, odoo: j.odoo, brevo: j.brevo }); }).catch(() => { /* hors ligne */ }); return () => { ok = false; }; }, []);

  const coopCert = useMemo(() => { const m = new Map<number, number | null>(); coops.forEach((c) => m.set(c.id, c.certificat)); return m; }, [coops]);
  const liste = useMemo(() => {
    const s = q.trim().toLowerCase();
    return demandes.filter((d: Demande) => (filtre === 'toutes' || (filtre === 'validees' ? d.valide_registre : !d.valide_registre))
      && (!s || [d.nom, d.prenom, d.email, d.reference_bancaire, d.ville, d.representant].some((x) => (x || '').toLowerCase().includes(s))));
  }, [demandes, filtre, q]);
  const nTraiter = demandes.filter((d: Demande) => !d.valide_registre).length;

  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } finally { setBusy(''); } };

  const synchroniser = (body: object) => run('sync', async () => {
    const j = await appelApi('/api/cooperateurs/google-sheet', body);
    if (j.simulation && !j.importees && j.apercu) setDemo(j.message); else setDemo('');
    notify(j.message || 'Terminé', j.ok ? (j.simulation ? 'info' : 'ok') : 'bad');
    if (j.ok) await reload();
  });
  const tester = async () => {
    setDiag('charge');
    try {
      const r = await fetch('/api/cooperateurs/diagnostic', { credentials: 'same-origin' }); const j = await r.json();
      if (!j.ok) { setDiag(null); notify(j.message || 'Diagnostic impossible', 'bad'); return; }
      setDiag(j.services);
    } catch (e: any) { setDiag(null); notify('Diagnostic impossible : ' + (e && e.message ? e.message : e), 'bad'); }
  };
  const importerCsv = async (f: File | undefined) => { if (!f) return; const t = await f.text(); await synchroniser({ csv: t }); if (fileRef.current) fileRef.current.value = ''; };

  const maj = (d: Demande, patch: Partial<Demande>) => run('u' + d.id, async () => {
    const r = await supabase.from('cooperateur_demandes').update(patch).eq('id', d.id);
    if (r.error) notify(r.error.message, 'bad'); else await reload();
  });
  const odoo = (d: Demande, action: string) => run(action + d.id, async () => {
    const j = await appelApi('/api/cooperateurs/odoo', { action, demande_id: d.id });
    notify(j.message || 'Terminé', j.ok ? (j.simulation ? 'info' : 'ok') : 'bad'); await reload();
  });
  const signatures = () => run('sigall', async () => { const j = await appelApi('/api/cooperateurs/odoo', { action: 'sign_status_all' }); notify(j.message || 'Terminé', j.ok ? 'ok' : 'bad'); await reload(); });
  const valider = () => run('val', async () => {
    if (!conf) return;
    const j = await appelApi('/api/cooperateurs/valider', { demande_id: conf.id, date: datePaie || undefined });
    setConf(null);
    if (!j.ok) { notify(j.message || 'Validation impossible', 'bad'); return; }
    notify(j.message + (j.warnings && j.warnings.length ? ' · ' + j.warnings.join(' · ') : ''), j.warnings && j.warnings.length ? 'info' : 'ok'); await reload();
  });
  const resync = (d: Demande) => run('rs' + d.id, async () => { const j = await appelApi('/api/cooperateurs/valider', { demande_id: d.id, resync: true }); notify((j.warnings && j.warnings.length ? j.warnings.join(' · ') : j.message) || 'Terminé', j.ok && !(j.warnings || []).length ? 'ok' : 'info'); await reload(); });
  const deverrouiller = () => run('unl', async () => {
    if (!unlock) return;
    const r = await supabase.rpc('deverrouiller_demande', { p_demande: unlock.id, p_motif: motif });
    if (r.error) { notify(r.error.message, 'bad'); return; }
    setUnlock(null); setMotif(''); notify('Ligne déverrouillée : la correction est tracée dans le journal d’audit (le registre n’est pas modifié)', 'info'); await reload();
  });
  const reverrouiller = (d: Demande) => run('lk' + d.id, async () => { const r = await supabase.rpc('reverrouiller_demande', { p_demande: d.id }); if (r.error) notify(r.error.message, 'bad'); else await reload(); });
  const supprimer = (d: Demande) => run('del' + d.id, async () => {
    if (!window.confirm(`Supprimer la demande de ${d.nom} ${d.prenom || ''} ?`)) return;
    const r = await supabase.from('cooperateur_demandes').delete().eq('id', d.id); if (r.error) notify(r.error.message, 'bad'); else await reload();
  });
  const emailCert = (d: Demande) => run('mail' + d.id, async () => { const j = await appelApi('/api/cooperateurs/certificat', { demande_id: d.id, civilite: civ[d.id] || '' }); notify(j.message || 'Terminé', j.ok ? (j.simulation ? 'info' : 'ok') : 'bad'); await reload(); });
  const ouvrir = (d: Demande) => { window.open(`/api/cooperateurs/certificat?demande=${encodeURIComponent(d.id)}&civilite=${encodeURIComponent(civ[d.id] || '')}`, '_blank'); setTimeout(() => { reload(); }, 1500); };

  const ouvrirValidation = (d: Demande) => { setDatePaie(d.date_paiement ? d.date_paiement.slice(0, 10) : ''); setConf(d); };
  const existant = conf && conf.is_existing_coop && conf.existing_coop_id != null ? conf : null;

  return (
    <>
      <div className="co-bar">
        <button type="button" className="co-btn primary" disabled={!canWrite || busy === 'sync'} onClick={() => synchroniser({})}>🔄 {busy === 'sync' ? 'Synchronisation…' : 'Synchroniser Google Sheet'}</button>
        <button type="button" className="co-btn" disabled={!canWrite || busy === 'sync'} onClick={() => fileRef.current && fileRef.current.click()}>⭳ Importer un CSV</button>
        <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" hidden onChange={(e: React.ChangeEvent<HTMLInputElement>) => importerCsv(e.target.files ? e.target.files[0] : undefined)} />
        <button type="button" className="co-btn" disabled={!canWrite || busy === 'sigall'} onClick={signatures} title="Interroge Odoo Sign pour les bulletins envoyés">✍ Actualiser les signatures</button>
        <span style={{ flex: 1 }} />
        {isAdmin ? <button type="button" className="co-btn ghost" onClick={tester} disabled={diag === 'charge'} title="Vérifie pas à pas Google Sheet, Odoo et Brevo (administrateurs)">🩺 {diag === 'charge' ? 'Test…' : 'Tester les connecteurs'}</button> : null}
        {cfg ? (['google', 'odoo', 'brevo'] as const).map((k) => <span key={k} className={'co-chip ' + (cfg[k] ? 'ok' : 'sim')} title={cfg[k] ? 'Connecteur configuré' : 'Variables d’environnement absentes : mode simulation'}>{k === 'google' ? 'Google Sheet' : k === 'odoo' ? 'Odoo' : 'Brevo'} : {cfg[k] ? 'connecté' : 'simulation'}</span>) : null}
      </div>
      {demo ? <div className="co-msg info" role="status">{demo} <button type="button" className="co-btn sm" disabled={!canWrite} onClick={() => synchroniser({ simulation_import: true })}>Importer les lignes de démonstration</button></div> : null}
      <div className="co-bar">
        <input type="search" aria-label="Rechercher une demande" placeholder="Rechercher nom, e-mail, référence, ville…" value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} />
        <select aria-label="Filtrer les demandes" value={filtre} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFiltre(e.target.value as Filtre)}>
          <option value="traiter">À traiter ({nTraiter})</option><option value="validees">Validées dans le registre</option><option value="toutes">Toutes ({demandes.length})</option>
        </select>
        <span className="co-hint">{liste.length} demande{liste.length > 1 ? 's' : ''}</span>
      </div>

      <div className="co-wrap">
        <table className="co-tbl">
          <thead><tr><th>Date</th><th>Référence virement</th><th>Souscripteur</th><th className="n">Parts &amp; montant</th><th>Odoo Sign</th><th>Paiement</th><th>Registre</th><th>Actions</th></tr></thead>
          <tbody>
            {liste.length === 0 ? <tr><td colSpan={8} className="co-hint" style={{ padding: 18 }}>Aucune demande. Cliquez sur « Synchroniser Google Sheet » ou importez un CSV.</td></tr> : null}
            {liste.map((d: Demande) => {
              const lock = d.is_locked; const off = !canWrite || lock;
              const certX = d.existing_coop_id != null ? coopCert.get(d.existing_coop_id) : null;
              const demoRow = Boolean(d.donnees_brutes && d.donnees_brutes.simulation);
              return (
                <tr key={d.id} className={lock ? 'locked' : ''} aria-label={`Demande de ${d.nom} ${d.prenom || ''}`}>
                  <td>{fmtDateHeure(d.date_demande).slice(0, 10)}<span className="co-sub">{fmtDateHeure(d.date_demande).slice(11)}</span></td>
                  <td>{d.reference_bancaire ? <CopyBadge text={d.reference_bancaire} onCopied={() => notify('Référence copiée : ' + d.reference_bancaire, 'ok')} /> : '—'}</td>
                  <td>
                    <b>{d.nom}</b> {d.prenom || ''} <span className="co-chip">{d.categorie_code}</span> {demoRow ? <span className="co-chip sim">démo</span> : null}
                    <span className="co-sub">{d.categorie_code === 'C' ? 'Institutionnel' : d.categorie_code === 'D' ? 'Entreprise' : 'Personne physique'}{d.representant ? ' · rep. ' + d.representant : ''} · {[d.email, d.ville].filter(Boolean).join(' · ')}</span>
                    {d.is_existing_coop ? <span className="co-chip gold" title="Même e-mail ou même numéro national qu'un coopérateur existant">Rachat de parts (Cert. n° {certX ?? '—'})</span> : null}{' '}
                    {d.numero_national ? <span className={'co-chip ' + (d.numero_valide === false ? 'bad' : '')} title={d.numero_valide === false ? 'Clé de contrôle (modulo 97) incorrecte' : 'Numéro valide'}>{fmtNumero(d.numero_national)}{d.numero_valide === false ? ' ⚠' : ''}</span> : null}
                  </td>
                  <td className="n">
                    <input type="number" min={1} step={1} aria-label={`Nombre de parts de ${d.nom}`} style={{ width: 62, height: 28, textAlign: 'right' }} disabled={off || busy === 'u' + d.id} defaultValue={d.nombre_parts} key={d.id + ':' + d.nombre_parts}
                      onBlur={(e: React.FocusEvent<HTMLInputElement>) => { const n = Math.max(1, parseInt(e.target.value, 10) || 1); if (n !== d.nombre_parts) maj(d, { nombre_parts: n }); }} />
                    <span className="co-sub">{fmtMontant(d.montant_total ?? d.nombre_parts * valeurPart)}</span>
                  </td>
                  <td>
                    <span className={'co-chip ' + (SIGN_CLASS[d.odoo_sign_status] || '')}>{SIGN_LABEL[d.odoo_sign_status]}</span>{isSim(d.odoo_sign_request_id) ? <span className="co-chip sim" title="Envoi simulé">sim.</span> : null}
                    <div className="co-acts" style={{ marginTop: 4 }}>
                      {d.odoo_sign_status === 'a_envoyer' ? <button type="button" className="co-btn sm" disabled={off || busy === 'sign_send' + d.id || !d.email} title={d.email ? '' : 'Pas d’e-mail'} onClick={() => odoo(d, 'sign_send')}>Envoyer Odoo Sign</button> : null}
                      {d.odoo_sign_status === 'envoye' ? <button type="button" className="co-btn sm" disabled={off || busy === 'sign_remind' + d.id} onClick={() => odoo(d, 'sign_remind')}>Relancer</button> : null}
                      {d.odoo_sign_status === 'envoye' ? <button type="button" className="co-btn sm ghost" disabled={off || busy === 'sign_status' + d.id} onClick={() => odoo(d, 'sign_status')} title="Vérifier dans Odoo si le bulletin est signé">↻</button> : null}
                    </div>
                    {d.date_dernier_rappel ? <span className="co-sub">Rappel : {fmtDate(d.date_dernier_rappel)}</span> : null}
                  </td>
                  <td>
                    <label className="co-chk"><input type="checkbox" checked={d.paiement_confirme} disabled={off || busy === 'u' + d.id} onChange={(e: React.ChangeEvent<HTMLInputElement>) => maj(d, { paiement_confirme: e.target.checked })} aria-label={`Paiement confirmé pour ${d.nom}`} /> Paiement confirmé</label>
                    {d.date_paiement ? <span className="co-sub">le {fmtDate(d.date_paiement)}</span> : null}
                  </td>
                  <td>
                    <label className="co-chk" title={d.paiement_confirme ? '' : 'Confirmez d’abord le paiement'}>
                      <input type="checkbox" checked={d.valide_registre} disabled={!canWrite || d.valide_registre || !d.paiement_confirme || busy === 'val'} onChange={() => ouvrirValidation(d)} aria-label={`Valider ${d.nom} dans le registre`} /> {d.valide_registre ? 'Au registre' : 'Valider dans le registre'}
                    </label>
                    {d.valide_registre ? <span className="co-sub">Cert. n° {d.certificat_numero ?? '—'} {lock ? '🔒' : ''}</span> : null}
                    {d.valide_registre ? <span className="co-sub">Odoo {d.odoo_mailing_synced ? '✓' : '·'} Brevo {d.brevo_synced ? '✓' : '·'}</span> : null}
                  </td>
                  <td>
                    <div className="co-acts">
                      {d.valide_registre ? (
                        <>
                          {d.type_souscripteur === 'personne_physique' ? <select aria-label="Civilité pour le certificat" className="co-btn sm" value={civ[d.id] || ''} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCiv((c) => ({ ...c, [d.id]: e.target.value }))}><option value="">civ.</option><option>M.</option><option>Mme</option></select> : null}
                          <button type="button" className="co-btn sm" onClick={() => ouvrir(d)}>📄 Certificat PDF</button>
                          <button type="button" className="co-btn sm" disabled={!canWrite || busy === 'mail' + d.id} onClick={() => emailCert(d)} title="Envoyer le certificat par e-mail">✉</button>
                          {(!d.odoo_mailing_synced || !d.brevo_synced) ? <button type="button" className="co-btn sm" disabled={!canWrite || busy === 'rs' + d.id} onClick={() => resync(d)} title="Relancer la synchronisation Odoo / Brevo">↻ Synchro</button> : null}
                          {d.certificat_genere ? <span className="co-chip ok">PDF généré</span> : null}
                        </>
                      ) : null}
                      {lock && isAdmin ? <button type="button" className="co-btn sm ghost" onClick={() => { setMotif(''); setUnlock(d); }} title="Correction exceptionnelle (tracée dans le journal)">🔓 Déverrouiller</button> : null}
                      {!lock && d.valide_registre && canWrite ? <button type="button" className="co-btn sm ghost" disabled={busy === 'lk' + d.id} onClick={() => reverrouiller(d)}>🔒 Reverrouiller</button> : null}
                      {!lock && !d.valide_registre && canWrite ? <button type="button" className="co-btn sm ghost danger" disabled={busy === 'del' + d.id} onClick={() => supprimer(d)} aria-label={`Supprimer la demande de ${d.nom}`}>🗑</button> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {conf ? (
        <Modal title="Valider dans le registre" onClose={() => setConf(null)}>
          <div className="co-sum">
            <b>{conf.nom} {conf.prenom || ''}</b>
            <span>{conf.nombre_parts} part{conf.nombre_parts > 1 ? 's' : ''} · {fmtMontant(conf.nombre_parts * valeurPart)} · classe {conf.categorie_code}</span>
            {existant ? <span>Coopérateur existant (certificat n° {coopCert.get(existant.existing_coop_id as number) ?? '—'}) : seul un <b>mouvement de parts</b> est ajouté, le n° de certificat ne change pas.</span>
              : <span>Nouveau coopérateur : création de la fiche, de l’adresse et des contacts, certificat n° <b>{prochainCertificat(coops)}</b> (calculé définitivement à la validation).</span>}
          </div>
          {conf.odoo_sign_status !== 'signe' ? <p className="co-msg info">Le bulletin n’est pas marqué « Signé » ({SIGN_LABEL[conf.odoo_sign_status].toLowerCase()}).</p> : null}
          {conf.numero_valide === false ? <p className="co-msg bad">Le numéro national / d’entreprise a une clé de contrôle incorrecte : vérifiez-le avant de valider.</p> : null}
          <label className="co-f">Date du mouvement de parts (date du paiement)<input type="date" value={datePaie} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDatePaie(e.target.value)} /></label>
          <p className="co-hint">Après validation : synchronisation vers la liste « Coopérateurs » d’Odoo et vers Brevo, puis la ligne est verrouillée (déverrouillage réservé aux administrateurs, avec trace dans le journal).</p>
          <div className="co-acts" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="co-btn" onClick={() => setConf(null)}>Annuler</button>
            <button type="button" className="co-btn gold" disabled={busy === 'val'} onClick={valider}>{busy === 'val' ? 'Validation…' : 'Confirmer la validation'}</button>
          </div>
        </Modal>
      ) : null}
      {unlock ? (
        <Modal title="Déverrouiller la ligne" onClose={() => setUnlock(null)}>
          <p className="co-msg info">Correction exceptionnelle de la demande de {unlock.nom} {unlock.prenom || ''}. Le registre (fiche et mouvement de parts) n’est <b>pas</b> modifié automatiquement ; l’action est consignée dans le journal d’audit.</p>
          <label className="co-f">Motif (obligatoire)<input type="text" value={motif} maxLength={200} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMotif(e.target.value)} placeholder="ex. faute de frappe sur le téléphone" /></label>
          <div className="co-acts" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="co-btn" onClick={() => setUnlock(null)}>Annuler</button>
            <button type="button" className="co-btn gold" disabled={motif.trim().length < 3 || busy === 'unl'} onClick={deverrouiller}>Déverrouiller</button>
          </div>
        </Modal>
      ) : null}
      {diag && diag !== 'charge' ? (
        <Modal title="Test des connecteurs" onClose={() => setDiag(null)} wide>
          {diag.map((d) => (
            <section key={d.service} className="co-card" style={{ marginBottom: 10 }}>
              <h2>{d.service === 'google' ? 'Google Sheet' : d.service === 'odoo' ? 'Odoo (Sign + liste de diffusion)' : 'Brevo'} <span className={'co-chip ' + (!d.configure ? 'sim' : d.ok ? 'ok' : 'bad')}>{!d.configure ? 'simulation' : d.ok ? 'prêt' : 'à corriger'}</span></h2>
              <ul style={{ margin: '6px 0', paddingLeft: 18, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {d.etapes.map((e, i: number) => <li key={i}>{e.ok ? '✅' : '⚠️'} <b>{e.libelle}</b>{e.detail ? ' : ' + e.detail : ''}</li>)}
              </ul>
              {d.aide.map((a: string, i: number) => <p key={i} className="co-hint" style={{ margin: '4px 0' }}>{a}</p>)}
            </section>
          ))}
          <p className="co-hint">Aucune donnée n’est créée ni modifiée chez Google, Odoo ou Brevo pendant ce test. Les clés ne sont jamais affichées.</p>
        </Modal>
      ) : null}
    </>
  );
}
