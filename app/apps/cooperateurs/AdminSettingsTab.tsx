'use client';
// app/apps/cooperateurs/AdminSettingsTab.tsx : onglet « Paramètres » (administrateurs uniquement)
//   1. Mode Démo / Présentation : masquage à la volée des données personnelles à l'écran (aucune modification en base, réversible).
//   2. Anonymisation RGPD définitive en base (IRRÉVERSIBLE) : périmètre A (coopérateurs) ou B (demandes ET coopérateurs).
import React, { useEffect, useState } from 'react';
import { appelApi } from './data';
import { Modal } from './ui';
import type { TabProps } from './CooperateursApp';

type Apercu = { cooperateurs: number; contacts: number; adresses: number; demandes: number; journal: number; groupes_doublons: number; parts: number };
type Perimetre = 'cooperateurs' | 'tout';
const MOT = 'ANONYMISER';

export default function AdminSettingsTab({ store, reload, notify, demo, setDemo }: TabProps & { demo: boolean; setDemo: (v: boolean) => void }) {
  const [perimetre, setPerimetre] = useState<Perimetre>('cooperateurs');
  const [garderCommune, setGarderCommune] = useState(true);
  const [apercu, setApercu] = useState<Apercu | null>(null); const [erreur, setErreur] = useState('');
  const [ouvert, setOuvert] = useState(false); const [saisie, setSaisie] = useState(''); const [compris, setCompris] = useState(false);
  const [busy, setBusy] = useState(false); const [resultat, setResultat] = useState<any>(null);

  useEffect(() => {
    if (!store.isAdmin || demo) return; let ok = true;
    appelApi('/api/cooperateurs/anonymiser', { action: 'apercu' }).then((j: any) => { if (!ok) return; if (j.ok) { setApercu(j.apercu); setErreur(''); } else setErreur(j.message || 'Aperçu indisponible'); });
    return () => { ok = false; };
  }, [store.isAdmin, demo, resultat]);

  if (!store.isAdmin) return <p className="co-msg bad" role="alert">Cette page est réservée aux administrateurs.</p>;

  const fermer = () => { setOuvert(false); setSaisie(''); setCompris(false); };
  const lancer = async () => {
    setBusy(true);
    const j = await appelApi('/api/cooperateurs/anonymiser', { perimetre, confirmation: saisie.trim(), garder_commune: garderCommune });
    setBusy(false);
    if (!j.ok) { notify(j.message || 'Anonymisation impossible', 'bad'); return; }
    fermer(); setResultat(j.resultat); notify('Anonymisation terminée : les données personnelles ont été remplacées de façon irréversible', 'ok'); await reload();
  };
  const n = (v: number | undefined): string => (v == null ? '…' : String(v));

  return (
    <>
      <section className="co-card" aria-labelledby="st-demo">
        <h2 id="st-demo">Mode Démo / Présentation</h2>
        <p className="co-hint">Masque à l’écran les noms, e-mails, téléphones, numéros nationaux/BCE, rues, métiers et bénéficiaires (ex. « J*** D*** », « j****@badjawe.be »). Les montants, parts et numéros de certificat restent visibles. <b>Aucune donnée n’est modifiée</b> ; l’application passe en lecture seule tant que le mode est actif.</p>
        <label className="co-chk"><input type="checkbox" checked={demo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDemo(e.target.checked)} /> Activer le mode démo <small>(également disponible via le bouton « 🕶 Démo » en haut de page)</small></label>
      </section>

      <section className="co-card danger" aria-labelledby="st-anon">
        <h2 id="st-anon">Anonymisation RGPD définitive</h2>
        <p className="co-msg bad" role="note"><b>Action irréversible.</b> Les données personnelles sont remplacées dans la base (ex. « Anonyme-0012 », e-mail <code>anonyme-12-…@example.invalid</code>). Les <b>montants, parts, numéros de certificats et mouvements comptables sont conservés</b>. À utiliser pour fournir une base de test/démo ou répondre à une demande d’effacement globale.</p>
        {demo ? <p className="co-hint">Désactivez le mode démo pour accéder à l’aperçu et à l’anonymisation.</p> : (
          <>
            {erreur ? <p className="co-msg bad" role="alert">{erreur}</p> : null}
            <fieldset className="co-fs"><legend>Périmètre</legend>
              <label className="co-chk"><input type="radio" name="perim" checked={perimetre === 'cooperateurs'} onChange={() => setPerimetre('cooperateurs')} /> <b>A — Coopérateurs uniquement</b> : fiches, contacts, adresses ({n(apercu?.cooperateurs)} fiches, {n(apercu?.contacts)} contacts). Les demandes de souscription restent intactes.</label>
              <label className="co-chk"><input type="radio" name="perim" checked={perimetre === 'tout'} onChange={() => setPerimetre('tout')} /> <b>B — Ensemble</b> : coopérateurs <u>et</u> demandes de souscription ({n(apercu?.demandes)} demandes en plus).</label>
              <label className="co-chk"><input type="checkbox" checked={garderCommune} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGarderCommune(e.target.checked)} /> Conserver le code postal et la commune (statistiques géographiques)</label>
            </fieldset>
            <p className="co-hint">Le journal d’audit ({n(apercu?.journal)} lignes) est nettoyé des données personnelles ; {n(apercu?.parts)} parts au total seront conservées à l’identique.</p>
            <div className="co-acts"><button type="button" className="co-btn danger" onClick={() => setOuvert(true)} disabled={!apercu}>⚠ Anonymiser définitivement…</button></div>
          </>
        )}
        {resultat ? <p className="co-msg ok" role="status">Dernière anonymisation : {resultat.cooperateurs} fiches, {resultat.contacts} contacts, {resultat.adresses} adresses, {resultat.demandes} demandes, {resultat.lignes_journal} lignes de journal ; {resultat.parts} parts conservées.</p> : null}
      </section>

      {ouvert ? (
        <Modal title="Confirmer l’anonymisation définitive" onClose={busy ? () => undefined : fermer}>
          <p className="co-msg bad" role="alert"><b>Cette opération ne peut pas être annulée.</b> Périmètre : {perimetre === 'tout' ? 'coopérateurs ET demandes de souscription' : 'coopérateurs uniquement'}.</p>
          <ul className="co-hint">
            <li>Noms, prénoms, e-mails, téléphones, adresses, numéros nationaux/BCE, métiers et bénéficiaires seront remplacés.</li>
            <li>Les montants, parts, numéros de certificats et mouvements comptables restent inchangés.</li>
            <li><b>Rien n’est modifié en dehors de cette base</b> : Google Sheet de réponses, Odoo, Brevo, certificats PDF déjà envoyés et sauvegardes Supabase conservent les données d’origine.</li>
            <li>Faites une sauvegarde de la base (Supabase) avant de continuer.</li>
          </ul>
          <label className="co-chk"><input type="checkbox" checked={compris} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCompris(e.target.checked)} /> J’ai compris que l’opération est irréversible et qu’une sauvegarde existe.</label>
          <label className="co-f">Saisissez le mot <b>{MOT}</b> pour confirmer<input value={saisie} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSaisie(e.target.value)} autoComplete="off" spellCheck={false} aria-label={'Saisir ' + MOT} /></label>
          <div className="co-acts"><span style={{ flex: 1 }} />
            <button type="button" className="co-btn" onClick={fermer} disabled={busy}>Annuler</button>
            <button type="button" className="co-btn danger" onClick={lancer} disabled={busy || !compris || saisie.trim() !== MOT}>{busy ? 'Anonymisation…' : 'Anonymiser définitivement'}</button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
