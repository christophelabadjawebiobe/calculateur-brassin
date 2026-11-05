'use client';
// app/apps/cooperateurs/RegistreTab.tsx : onglet 2 « Registre des Coopérateurs » (recherche, filtres, fiche détaillée)
import React, { useEffect, useMemo, useState } from 'react';
import type { Cooperateur, JournalRow } from '@/lib/cooperateurs/types';
import { fmtDate, fmtDateHeure, fmtMontant, fmtNumero, analyseNumero } from '@/lib/cooperateurs/numbers';
import { lignesRegistre, pctCapital, telechargerCsv, versCsv } from '@/lib/cooperateurs/export';
import { adresseDe, appelApi, emailDe, nomComplet, partsDe, telDe, villeDe } from './data';
import { Modal } from './ui';
import { ageAu, estMineur, resumeBenef } from '@/lib/cooperateurs/cadeau';
import type { TabProps } from './CooperateursApp';

type Statut = '' | 'actif' | 'sortant' | 'noemail' | 'nodate' | 'cadeau' | 'mineur';
const MAX = 300;

export default function RegistreTab({ store, reload, notify, supabase }: TabProps) {
  const { coops, categories, valeurPart, canWrite, isAdmin } = store;
  const [q, setQ] = useState(''); const [classe, setClasse] = useState(''); const [statut, setStatut] = useState<Statut>('');
  const [sel, setSel] = useState<number | null>(null);

  const lignes = useMemo(() => {
    const s = q.trim().toLowerCase();
    return coops.filter((c: Cooperateur) => {
      const p = partsDe(c);
      if (classe && (c.categories ? c.categories.code : '') !== classe) return false;
      if (statut === 'actif' && p <= 0) return false;
      if (statut === 'sortant' && p > 0) return false;
      if (statut === 'noemail' && emailDe(c)) return false;
      if (statut === 'cadeau' && !c.est_cadeau) return false;
      if (statut === 'mineur' && !(c.est_cadeau && estMineur(c.beneficiaire_date_naissance))) return false;
      if (statut === 'nodate' && !(p > 0 && (c.mouvements_parts || []).some((m) => !m.date_mouvement))) return false;
      if (!s) return true;
      return [c.nom, c.prenom, c.representant, c.beneficiaire_nom, c.beneficiaire_prenom, String(c.certificat ?? ''), emailDe(c), villeDe(c), c.numero_identification].some((x) => (x || '').toLowerCase().includes(s));
    }).sort((a: Cooperateur, b: Cooperateur) => (a.certificat ?? 1e9) - (b.certificat ?? 1e9) || a.nom.localeCompare(b.nom, 'fr'));
  }, [coops, q, classe, statut]);
  const totalParts = useMemo(() => coops.reduce((s: number, c: Cooperateur) => s + Math.max(0, partsDe(c)), 0), [coops]);
  const exporter = (anonyme: boolean) => {
    const x = lignesRegistre(lignes, valeurPart, { anonyme, total: totalParts });
    telechargerCsv(`registre-cooperateurs${anonyme ? '-anonymise' : ''}.csv`, versCsv(x.entetes, x.lignes));
    notify(anonyme ? 'Export anonymisé téléchargé (noms, e-mails, téléphones et numéros masqués ; adresses réduites à la commune)' : 'Export du registre téléchargé (données personnelles en clair : à protéger)', anonyme ? 'ok' : 'info');
  };
  const courant = sel != null ? coops.find((c: Cooperateur) => c.id === sel) || null : null;

  return (
    <>
      <div className="co-bar">
        <input type="search" aria-label="Rechercher un coopérateur" placeholder="Rechercher nom, n° certificat, e-mail, commune…" value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} />
        <select aria-label="Classe de parts" value={classe} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setClasse(e.target.value)}>
          <option value="">Toutes les classes</option>{categories.map((c) => <option key={c.id} value={c.code}>{c.code} — {c.libelle}</option>)}
        </select>
        <select aria-label="Statut" value={statut} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatut(e.target.value as Statut)}>
          <option value="">Tous statuts</option><option value="actif">Actifs</option><option value="sortant">Sortants (0 part)</option><option value="noemail">Sans e-mail</option><option value="nodate">Parts sans date</option><option value="cadeau">🎁 Parts offertes (cadeau)</option><option value="mineur">👶 Bénéficiaire mineur</option>
        </select>
        <button type="button" className="co-btn" onClick={() => exporter(true)} title="CSV compatible Excel : noms, e-mails, téléphones et numéros masqués">📥 Exporter le Registre (Anonymisé)</button>
        <button type="button" className="co-btn ghost" onClick={() => exporter(false)} title="CSV compatible Excel, données personnelles en clair">📥 Export standard</button>
        <span className="co-hint">{lignes.length} coopérateur{lignes.length > 1 ? 's' : ''}{lignes.length > MAX ? ` (${MAX} affichés : affinez la recherche)` : ''}</span>
      </div>
      <div className="co-wrap">
        <table className="co-tbl">
          <thead><tr><th className="n">N°</th><th>Nom</th><th>Prénom / représentant</th><th>Classe</th><th>Statut</th><th className="n">Parts</th><th className="n">Capital</th><th className="n">% du capital</th><th>Commune</th><th>E-mail</th></tr></thead>
          <tbody>
            {lignes.slice(0, MAX).map((c: Cooperateur) => { const p = partsDe(c); return (
              <tr key={c.id} className="sel" tabIndex={0} onClick={() => setSel(c.id)} onKeyDown={(e: React.KeyboardEvent<HTMLTableRowElement>) => { if (e.key === 'Enter') setSel(c.id); }} aria-label={`Fiche de ${nomComplet(c)}`}>
                <td className="n">{c.certificat ?? '—'}</td><td><b>{c.nom}</b></td><td>{c.prenom || (c.representant ? 'rep. ' + c.representant : '')}{c.est_cadeau ? <> <span className="co-chip gold" title={'Parts offertes : ' + resumeBenef(c)}>🎁 pour {c.beneficiaire_prenom || 'un bénéficiaire'}</span>{estMineur(c.beneficiaire_date_naissance) ? <> <span className="co-chip warn" title="Bénéficiaire mineur : le souscripteur est le responsable légal">👶 Mineur</span></> : null}</> : null}</td>
                <td><span className="co-chip">{c.categories ? c.categories.code : '—'}</span></td>
                <td><span className={'co-chip ' + (p > 0 ? 'ok' : '')}>{p > 0 ? 'Actif' : 'Sortant'}</span></td>
                <td className="n">{p}</td><td className="n">{fmtMontant(p * valeurPart)}</td><td className="n">{pctCapital(p, totalParts)}</td><td>{villeDe(c)}</td><td>{emailDe(c)}</td>
              </tr>); })}
            {lignes.length === 0 ? <tr><td colSpan={10} className="co-hint" style={{ padding: 18 }}>Aucun coopérateur ne correspond.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {courant ? <Fiche coop={courant} store={store} canWrite={canWrite} isAdmin={isAdmin} onClose={() => setSel(null)} reload={reload} notify={notify} supabase={supabase} /> : null}
    </>
  );
}

function Fiche({ coop, store, canWrite, isAdmin, onClose, reload, notify, supabase }: { coop: Cooperateur; store: TabProps['store']; canWrite: boolean; isAdmin: boolean; onClose: () => void; reload: () => Promise<void>; notify: TabProps['notify']; supabase: any }) {
  const { categories, valeurPart } = store;
  const [f, setF] = useState({ nom: coop.nom, prenom: coop.prenom || '', representant: coop.representant || '', numero: coop.numero_identification || '', categorie_id: coop.categorie_id ? String(coop.categorie_id) : '', remarques: coop.remarques || '' });
  const [journal, setJournal] = useState<JournalRow[] | null>(null);
  const [civ, setCiv] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { setF({ nom: coop.nom, prenom: coop.prenom || '', representant: coop.representant || '', numero: coop.numero_identification || '', categorie_id: coop.categorie_id ? String(coop.categorie_id) : '', remarques: coop.remarques || '' }); }, [coop]);
  useEffect(() => {
    if (!canWrite && !isAdmin) return; let ok = true;
    supabase.from('journal').select('id,horodatage,utilisateur,action,operation,table_nom,cooperateur_id,libelle').eq('cooperateur_id', coop.id).order('id', { ascending: false }).limit(40).then((r: any) => { if (ok) setJournal(r.error ? [] : r.data); });
    return () => { ok = false; };
  }, [coop.id, canWrite, isAdmin, supabase]);

  const cadeaux = store.demandes.filter((x) => x.cooperateur_id === coop.id && x.est_cadeau).sort((x, y) => (y.date_demande || '').localeCompare(x.date_demande || ''));
  const mv = (coop.mouvements_parts || []).slice().sort((a, b) => (a.date_mouvement || '9999').localeCompare(b.date_mouvement || '9999') || a.id - b.id);
  const total = mv.reduce((s: number, m) => s + m.nombre_parts, 0); const a = adresseDe(coop);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const enregistrer = async () => {
    if (!f.nom.trim()) { notify('Le nom est obligatoire', 'bad'); return; }
    const num = analyseNumero(f.numero);
    if (f.numero.trim() && num.valide === false && !window.confirm('Le numéro saisi n’a pas une clé de contrôle valide (11 chiffres : numéro national, 10 : numéro d’entreprise). Enregistrer quand même ?')) return;
    setBusy(true);
    const r = await supabase.from('cooperateurs').update({ nom: f.nom.trim(), prenom: f.prenom.trim() || null, representant: f.representant.trim() || null, numero_identification: num.digits || null, categorie_id: f.categorie_id ? Number(f.categorie_id) : null, remarques: f.remarques.trim() || null }).eq('id', coop.id);
    setBusy(false);
    if (r.error) { notify(/duplicate|unique/i.test(r.error.message) ? 'Ce numéro est déjà utilisé par un autre coopérateur' : r.error.message, 'bad'); return; }
    notify('Fiche enregistrée', 'ok'); await reload();
  };
  const pdf = () => window.open(`/api/cooperateurs/certificat?cooperateur=${coop.id}&civilite=${encodeURIComponent(civ)}`, '_blank');
  const mail = async () => { setBusy(true); const j = await appelApi('/api/cooperateurs/certificat', { cooperateur_id: coop.id, civilite: civ }); setBusy(false); notify(j.message || 'Terminé', j.ok ? (j.simulation ? 'info' : 'ok') : 'bad'); };

  return (
    <Modal title={`${coop.certificat != null ? 'N° ' + coop.certificat + ' — ' : ''}${nomComplet(coop)}`} onClose={onClose} wide>
      <div className="co-kpis">
        <div className="co-kpi"><b>{total}</b><span>parts détenues</span></div>
        <div className="co-kpi"><b>{fmtMontant(total * valeurPart)}</b><span>capital</span></div>
        <div className="co-kpi"><b>{pctCapital(total, store.coops.reduce((s: number, c: Cooperateur) => s + Math.max(0, partsDe(c)), 0))}</b><span>du capital de la coopérative</span></div>
        <div className="co-kpi"><b>{coop.categories ? coop.categories.code : '—'}</b><span>{coop.categories ? coop.categories.libelle : 'sans classe'}</span></div>
      </div>
      {coop.est_cadeau ? (
        <div className="co-sum" role="note" aria-label="Parts offertes">
          <span><b>🎁 Parts détenues au nom d’un bénéficiaire (cadeau{estMineur(coop.beneficiaire_date_naissance) ? ' / mineur' : ''})</b></span>
          {(cadeaux.length ? cadeaux : [coop as any]).map((x: any, i: number) => (
            <span key={x.id || i}>Bénéficiaire : <b>{resumeBenef(x)}</b>{x.beneficiaire_email ? ' · ' + x.beneficiaire_email : ''}{x.nombre_parts ? ` · ${x.nombre_parts} part${x.nombre_parts > 1 ? 's' : ''}` : ''}{estMineur(x.beneficiaire_date_naissance) ? ' · 👶 mineur' : ageAu(x.beneficiaire_date_naissance) !== null ? ' · majeur aujourd’hui' : ''}</span>
          ))}
          <span>Souscripteur / responsable légal (titulaire de la fiche) : <b>{nomComplet(coop)}</b>{emailDe(coop) ? ' · ' + emailDe(coop) : ''}{telDe(coop) ? ' · ' + telDe(coop) : ''}</span>
          <span className="co-hint">Le certificat reste émis au nom du souscripteur. L’historique de chaque cadeau figure dans l’onglet « Souscriptions &amp; Demandes ».</span>
        </div>
      ) : null}
      <p className="co-hint">✉ Newsletter : {coop.consentement_newsletter ? 'consentement « Oui » (contact envoyé à Odoo / Brevo)' : 'pas de consentement (aucun envoi Odoo / Brevo)'}</p>
      <div className="co-grid">
        <label className="co-f">Nom<input value={f.nom} onChange={set('nom')} disabled={!canWrite} /></label>
        <label className="co-f">Prénom<input value={f.prenom} onChange={set('prenom')} disabled={!canWrite} /></label>
        <label className="co-f">Représentant<input value={f.representant} onChange={set('representant')} disabled={!canWrite} /></label>
        <label className="co-f">N° national / d’entreprise <small>{f.numero ? fmtNumero(analyseNumero(f.numero).digits) : ''}</small><input value={f.numero} onChange={set('numero')} disabled={!canWrite} /></label>
        <label className="co-f">Classe de parts<select value={f.categorie_id} onChange={set('categorie_id')} disabled={!canWrite}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.libelle}</option>)}</select></label>
        <label className="co-f">Remarques<textarea rows={2} value={f.remarques} onChange={set('remarques')} disabled={!canWrite} /></label>
      </div>
      <div className="co-sum">
        <span><b>Coordonnées</b></span>
        <span>{a ? [[a.rue, a.numero].filter(Boolean).join(' '), [a.code_postal, a.ville].filter(Boolean).join(' '), a.pays].filter(Boolean).join(', ') : 'Adresse non renseignée'}</span>
        <span>{(coop.contacts || []).length ? (coop.contacts || []).map((c) => `${c.type === 'email' ? '✉' : '☎'} ${c.valeur}${c.principal ? ' (principal)' : ''}`).join(' · ') : 'Aucun contact'}</span>
      </div>
      <div className="co-wrap" style={{ maxHeight: 220 }}>
        <table className="co-tbl"><thead><tr><th>Date</th><th className="n">Parts</th><th className="n">Montant</th><th>Nature</th></tr></thead><tbody>
          {mv.map((m) => <tr key={m.id}><td>{fmtDate(m.date_mouvement) || '—'}</td><td className="n">{m.nombre_parts}</td><td className="n">{fmtMontant(m.montant_total ?? m.nombre_parts * valeurPart)}</td><td>{m.nombre_parts < 0 ? 'Remboursement / cession' : m.demande_id ? 'Souscription (formulaire)' : 'Prise de parts'}</td></tr>)}
          {mv.length === 0 ? <tr><td colSpan={4} className="co-hint">Aucun mouvement.</td></tr> : null}
        </tbody></table>
      </div>
      <div className="co-acts">
        {!['C', 'D'].includes(coop.categories ? coop.categories.code : '') ? <select aria-label="Civilité" className="co-btn" value={civ} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCiv(e.target.value)}><option value="">civilité</option><option>M.</option><option>Mme</option></select> : null}
        <button type="button" className="co-btn" onClick={pdf} disabled={total <= 0}>📄 Certificat PDF</button>
        <button type="button" className="co-btn" onClick={mail} disabled={!canWrite || busy || !emailDe(coop) || total <= 0}>✉ Envoyer par e-mail</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="co-btn primary" onClick={enregistrer} disabled={!canWrite || busy}>Enregistrer la fiche</button>
      </div>
      {journal ? (
        <details><summary className="co-hint" style={{ cursor: 'pointer' }}>Journal d’audit de cette fiche ({journal.length})</summary>
          <div className="co-wrap" style={{ maxHeight: 200, marginTop: 6 }}><table className="co-tbl"><tbody>
            {journal.map((j: JournalRow) => <tr key={j.id}><td>{fmtDateHeure(j.horodatage)}</td><td>{j.utilisateur || ''}</td><td>{j.operation} {j.table_nom}</td><td>{j.action || ''}</td></tr>)}
            {journal.length === 0 ? <tr><td className="co-hint">Aucune entrée.</td></tr> : null}
          </tbody></table></div></details>
      ) : null}
    </Modal>
  );
}
