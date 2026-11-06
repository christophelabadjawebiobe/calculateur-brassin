'use client';
// app/apps/cooperateurs/EditCooperateurModal.tsx : « ✏ Modifier » : édition manuelle d'une fiche coopérateur depuis le Registre.
// Les parts, le capital, le certificat et les mouvements ne sont PAS modifiables ici (intégrité comptable : onglet « Mouvements & Parts »).
// Seuls les champs réellement modifiés sont envoyés à /api/cooperateurs/modifier (fonction SQL modifier_cooperateur) ; l'audit est écrit par la base.
import React, { useMemo, useState } from 'react';
import type { Cooperateur } from '@/lib/cooperateurs/types';
import { analyseNumero, fmtNumero } from '@/lib/cooperateurs/numbers';
import { adresseDe, appelApi, emailDe, telDe } from './data';
import { Modal } from './ui';
import type { TabProps } from './CooperateursApp';

type F = {
  nom: string; prenom: string; representant: string; numero: string; email: string; telephone: string;
  rue: string; num: string; code_postal: string; ville: string; pays: string;
  profession: string; competences: string; accord: '' | 'oui' | 'non';
  est_cadeau: boolean; b_nom: string; b_prenom: string; b_naissance: string; b_lien: string; b_email: string;
};
const LIENS = ['Parent', 'Grand-parent', 'Parrain/Marraine', 'Proche'];

function initial(c: Cooperateur): F {
  const a = adresseDe(c);
  return {
    nom: c.nom || '', prenom: c.prenom || '', representant: c.representant || '', numero: c.numero_identification || '', email: emailDe(c), telephone: telDe(c),
    rue: a && a.rue ? a.rue : '', num: a && a.numero ? a.numero : '', code_postal: a && a.code_postal ? a.code_postal : '', ville: a && a.ville ? a.ville : '', pays: a && a.pays ? a.pays : '',
    profession: c.profession || '', competences: c.competences || '', accord: c.accord_contact_tel === true ? 'oui' : c.accord_contact_tel === false ? 'non' : '',
    est_cadeau: Boolean(c.est_cadeau), b_nom: c.beneficiaire_nom || '', b_prenom: c.beneficiaire_prenom || '', b_naissance: c.beneficiaire_date_naissance || '', b_lien: c.beneficiaire_lien || '', b_email: c.beneficiaire_email || '',
  };
}

/** Champs modifiés → charge utile pour modifier_cooperateur() (clés = colonnes / clés acceptées par la fonction SQL) */
export function champsModifies(o: F, n: F): Record<string, any> {
  const d: Record<string, any> = {};
  const txt = (cle: string, a: string, b: string) => { if (a.trim() !== b.trim()) d[cle] = b.trim(); };
  txt('nom', o.nom, n.nom); txt('prenom', o.prenom, n.prenom); txt('representant', o.representant, n.representant);
  const chiffres = (s: string) => analyseNumero(s).digits || '';
  if (chiffres(o.numero) !== chiffres(n.numero)) d.numero_identification = chiffres(n.numero);
  txt('email', o.email, n.email); txt('telephone', o.telephone, n.telephone);
  txt('rue', o.rue, n.rue); txt('numero', o.num, n.num); txt('code_postal', o.code_postal, n.code_postal); txt('ville', o.ville, n.ville); txt('pays', o.pays, n.pays);
  txt('profession', o.profession, n.profession); txt('competences', o.competences, n.competences);
  if (n.accord && n.accord !== o.accord) d.accord_contact_tel = n.accord === 'oui';
  if (o.est_cadeau !== n.est_cadeau) d.est_cadeau = n.est_cadeau;
  if (n.est_cadeau) {
    txt('beneficiaire_nom', o.b_nom, n.b_nom); txt('beneficiaire_prenom', o.b_prenom, n.b_prenom); txt('beneficiaire_lien', o.b_lien, n.b_lien); txt('beneficiaire_email', o.b_email, n.b_email);
    if (o.b_naissance !== n.b_naissance) d.beneficiaire_date_naissance = n.b_naissance;
  }
  return d;
}

export default function EditCooperateurModal({ coop, onClose, reload, notify }: { coop: Cooperateur; onClose: () => void; reload: TabProps['reload']; notify: TabProps['notify'] }) {
  const origine = useMemo(() => initial(coop), [coop]);
  const [f, setF] = useState<F>(origine);
  const [busy, setBusy] = useState(false); const [erreur, setErreur] = useState('');
  const morale = !coop.prenom && Boolean(coop.representant) || (coop.categories ? ['C', 'D'].includes(coop.categories.code) : false);
  const set = (k: keyof F) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { const v = e.target.value; setF((x: F) => ({ ...x, [k]: v })); };
  const diff = useMemo(() => champsModifies(origine, f), [origine, f]);
  const nb = Object.keys(diff).length;
  const numAn = analyseNumero(f.numero);

  const enregistrer = async () => {
    setErreur('');
    if (!f.nom.trim()) { setErreur('Le nom (ou la raison sociale) est obligatoire.'); return; }
    if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) { setErreur('Adresse e-mail invalide.'); return; }
    if (diff.numero_identification && numAn.valide === false && !window.confirm('Le numéro saisi n’a pas une clé de contrôle valide (11 chiffres : registre national, 10 : numéro BCE). Enregistrer quand même ?')) return;
    setBusy(true);
    const j = await appelApi('/api/cooperateurs/modifier', { cooperateur_id: coop.id, data: diff });
    setBusy(false);
    if (!j.ok) { setErreur(j.message || 'Enregistrement impossible'); return; }
    notify(j.message || 'Fiche enregistrée', 'ok'); await reload(); onClose();
  };

  return (
    <Modal title={`Modifier la fiche — ${coop.certificat != null ? 'N° ' + coop.certificat : 'sans certificat'}`} onClose={onClose} wide>
      <p className="co-hint">Les <b>parts</b>, le <b>capital</b>, le n° de certificat et les mouvements ne sont pas modifiables ici (intégrité comptable : voir « Mouvements &amp; Parts »). Chaque modification est consignée dans le journal d’audit (champs modifiés, ancienne et nouvelle valeur, auteur, date).</p>
      <fieldset className="co-fs"><legend>Identité</legend>
        <div className="co-grid">
          <label className="co-f">{morale ? 'Raison sociale / nom' : 'Nom'}<input value={f.nom} onChange={set('nom')} autoFocus /></label>
          <label className="co-f">Prénom<input value={f.prenom} onChange={set('prenom')} /></label>
          <label className="co-f">Représentant (personne morale)<input value={f.representant} onChange={set('representant')} /></label>
          <label className="co-f">Registre national / n° BCE <small>{f.numero && numAn.digits ? fmtNumero(numAn.digits) + (numAn.valide === false ? ' · clé de contrôle invalide' : '') : ''}</small><input value={f.numero} onChange={set('numero')} inputMode="numeric" /></label>
        </div>
      </fieldset>
      <fieldset className="co-fs"><legend>Coordonnées</legend>
        <div className="co-grid">
          <label className="co-f">E-mail<input type="email" value={f.email} onChange={set('email')} /></label>
          <label className="co-f">Téléphone<input type="tel" value={f.telephone} onChange={set('telephone')} /></label>
          <label className="co-f">Rue<input value={f.rue} onChange={set('rue')} /></label>
          <label className="co-f">N°<input value={f.num} onChange={set('num')} /></label>
          <label className="co-f">Code postal<input value={f.code_postal} onChange={set('code_postal')} /></label>
          <label className="co-f">Ville<input value={f.ville} onChange={set('ville')} /></label>
          <label className="co-f">Pays<input value={f.pays} onChange={set('pays')} /></label>
        </div>
      </fieldset>
      <fieldset className="co-fs"><legend>Talents &amp; métier</legend>
        <div className="co-grid">
          <label className="co-f">Métier / profession<input value={f.profession} onChange={set('profession')} /></label>
          <label className="co-f">Accord de contact téléphonique
            <select value={f.accord} onChange={set('accord')}><option value="">— non renseigné —</option><option value="oui">Oui</option><option value="non">Non</option></select>
          </label>
          <label className="co-f" style={{ gridColumn: '1 / -1' }}>Compétences (séparées par des virgules)<textarea rows={2} value={f.competences} onChange={set('competences')} /></label>
        </div>
        <p className="co-hint">L’annuaire des compétences ne liste que les personnes ayant répondu « Oui » via le formulaire : une modification manuelle n’ajoute personne à l’annuaire.</p>
      </fieldset>
      <fieldset className="co-fs"><legend>Parts offertes (cadeau / mineur)</legend>
        <label className="co-chk"><input type="checkbox" checked={f.est_cadeau} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { const v = e.target.checked; setF((x: F) => ({ ...x, est_cadeau: v })); }} /> Les parts sont détenues au nom d’un bénéficiaire</label>
        {f.est_cadeau ? (
          <div className="co-grid">
            <label className="co-f">Nom du bénéficiaire<input value={f.b_nom} onChange={set('b_nom')} /></label>
            <label className="co-f">Prénom du bénéficiaire<input value={f.b_prenom} onChange={set('b_prenom')} /></label>
            <label className="co-f">Date de naissance<input type="date" value={f.b_naissance} onChange={set('b_naissance')} /></label>
            <label className="co-f">Lien de parenté<select value={f.b_lien} onChange={set('b_lien')}><option value="">—</option>{LIENS.map((l: string) => <option key={l} value={l}>{l}</option>)}{f.b_lien && !LIENS.includes(f.b_lien) ? <option value={f.b_lien}>{f.b_lien}</option> : null}</select></label>
            <label className="co-f">E-mail du bénéficiaire<input type="email" value={f.b_email} onChange={set('b_email')} /></label>
          </div>
        ) : (coop.est_cadeau ? <p className="co-hint">Décocher efface les données du bénéficiaire.</p> : null)}
      </fieldset>
      {erreur ? <p className="co-msg bad" role="alert">{erreur}</p> : null}
      <div className="co-acts">
        <span className="co-hint">{nb ? `${nb} champ${nb > 1 ? 's' : ''} modifié${nb > 1 ? 's' : ''}` : 'Aucune modification'}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="co-btn" onClick={onClose} disabled={busy}>Annuler</button>
        <button type="button" className="co-btn primary" onClick={enregistrer} disabled={busy || nb === 0}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </Modal>
  );
}
