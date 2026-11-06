'use client';
// app/apps/cooperateurs/AnnuaireCompetences.tsx : section « Annuaire des compétences & talents des coopérateurs » (onglet Statistiques, AG & Valorisation)
// Filtrage RGPD strict (lib/cooperateurs/annuaire.ts) : uniquement les fiches issues du Google Form avec accord de contact téléphonique « Oui ».
// Chargé côté client après les données : aucun formatage dépendant de la langue au rendu serveur.
import React, { useMemo, useState } from 'react';
import type { Cooperateur } from '@/lib/cooperateurs/types';
import { telechargerCsv, versCsv } from '@/lib/cooperateurs/export';
import { ENTETES_ANNUAIRE, construireAnnuaire, facettesMetiers, facettesTags, filtrer, lienTel, lignesAnnuaire, type Facette, type FicheAnnuaire } from '@/lib/cooperateurs/annuaire';
import { emailDe, nomComplet, telDe } from './data';
import type { Notify } from './CooperateursApp';

const NB_TAGS = 24;

function CopyBtn({ texte, label, notify }: { texte: string; label: string; notify: Notify }) {
  const copier = async () => {
    try { await navigator.clipboard.writeText(texte); }
    catch { const t = document.createElement('textarea'); t.value = texte; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch { /* ignoré */ } t.remove(); }
    notify(label + ' copié', 'ok');
  };
  return <button type="button" className="co-btn sm ghost" onClick={copier} aria-label={'Copier ' + label + ' : ' + texte} title={'Copier ' + texte}>⧉</button>;
}

export default function AnnuaireCompetences({ coops, notify }: { coops: Cooperateur[]; notify: Notify }) {
  const migre = coops.length === 0 || coops.some((c: Cooperateur) => 'profil_source' in c);   // false : les colonnes de sql/13 n'existent pas encore
  const fiches = useMemo(() => construireAnnuaire(coops, telDe, emailDe, nomComplet), [coops]);
  const tags = useMemo(() => facettesTags(fiches), [fiches]);
  const metiers = useMemo(() => facettesMetiers(fiches), [fiches]);
  const [q, setQ] = useState(''); const [sel, setSel] = useState<string[]>([]); const [tous, setTous] = useState(false); const [metier, setMetier] = useState(''); const [toutTags, setToutTags] = useState(false);
  const vue = useMemo(() => filtrer(fiches, { q, tags: sel, tous, metier }), [fiches, q, sel, tous, metier]);
  const bascule = (k: string) => setSel((s: string[]) => (s.includes(k) ? s.filter((x: string) => x !== k) : [...s, k]));
  const filtreActif = q.trim() !== '' || sel.length > 0 || metier !== '';
  const reinit = () => { setQ(''); setSel([]); setMetier(''); };
  const emails = vue.map((x: FicheAnnuaire) => x.email).filter(Boolean);
  const exporter = () => {
    if (!vue.length) return;
    telechargerCsv('annuaire-competences-' + new Date().toISOString().slice(0, 10) + '.csv', versCsv(ENTETES_ANNUAIRE, lignesAnnuaire(vue)));
    notify(vue.length + ' ligne(s) exportée(s) : fichier à usage interne (coordonnées de personnes ayant donné leur accord)', 'ok');
  };
  const tagsVisibles: Facette[] = toutTags ? tags : tags.slice(0, NB_TAGS);

  return (
    <div className="co-card" id="annuaire-competences">
      <h2>Annuaire des compétences &amp; talents des coopérateurs</h2>
      <p className="co-hint">Ne figurent ici que les coopérateurs ayant renseigné un métier ou des compétences dans le formulaire <b>et</b> répondu « Oui » à l’accord d’être contactés par téléphone (réponse « Non » ou absente : jamais listés). Les coordonnées servent uniquement à solliciter ces compétences pour la coopérative.</p>
      {!migre ? <p className="co-msg bad" role="alert">Les colonnes du profil n’existent pas encore : exécutez sql/13_cooperateurs_competences.sql dans Supabase, puis rechargez la page.</p> : null}
      <div className="co-bar" role="search" aria-label="Filtres de l’annuaire">
        <input type="search" aria-label="Rechercher dans l’annuaire" placeholder="Nom, prénom, métier ou compétence…" value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} />
        <select aria-label="Filtrer par métier" value={metier} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setMetier(e.target.value)}>
          <option value="">Tous les métiers</option>{metiers.map((m: Facette) => <option key={m.cle} value={m.cle}>{m.label} ({m.n})</option>)}
        </select>
        <select aria-label="Correspondance des étiquettes" value={tous ? 'tous' : 'un'} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTous(e.target.value === 'tous')} disabled={sel.length < 2}>
          <option value="un">Au moins une étiquette</option><option value="tous">Toutes les étiquettes</option>
        </select>
        <button type="button" className="co-btn" onClick={reinit} disabled={!filtreActif}>Réinitialiser</button>
        <button type="button" className="co-btn gold" onClick={exporter} disabled={!vue.length}>⭳ Exporter en CSV ({vue.length})</button>
        <button type="button" className="co-btn" disabled={!emails.length} onClick={async () => { const t = emails.join('; '); try { await navigator.clipboard.writeText(t); notify(emails.length + ' e-mail(s) copié(s)', 'ok'); } catch { notify('Copie impossible : utilisez l’export CSV', 'bad'); } }}>✉ Copier les e-mails ({emails.length})</button>
      </div>
      {tags.length ? (
        <div className="co-tags" role="group" aria-label="Compétences fréquentes : cliquer pour filtrer">
          {tagsVisibles.map((t: Facette) => <button key={t.cle} type="button" className={'co-tag' + (sel.includes(t.cle) ? ' on' : '')} aria-pressed={sel.includes(t.cle)} onClick={() => bascule(t.cle)}>{t.label} <small>{t.n}</small></button>)}
          {tags.length > NB_TAGS ? <button type="button" className="co-btn sm ghost" onClick={() => setToutTags((v: boolean) => !v)}>{toutTags ? 'Moins d’étiquettes' : `Toutes les étiquettes (${tags.length})`}</button> : null}
        </div>
      ) : null}
      <p className="co-hint" role="status">{vue.length} coopérateur{vue.length > 1 ? 's' : ''} affiché{vue.length > 1 ? 's' : ''}{fiches.length !== vue.length ? ` sur ${fiches.length}` : ''} dans l’annuaire.</p>
      <div className="co-wrap" style={{ maxHeight: 520 }}>
        <table className="co-tbl">
          <thead><tr><th>Coopérateur</th><th>Métier / Profession</th><th>Compétences &amp; talents</th><th>Téléphone</th><th>E-mail</th><th className="n">Parts</th></tr></thead>
          <tbody>
            {vue.map((x: FicheAnnuaire) => (
              <tr key={x.id}>
                <td><b>{x.nomComplet}</b></td>
                <td>{x.profession || '—'}</td>
                <td>{x.tags.length ? <span className="co-tags tight">{x.tags.map((t) => <button key={t.cle} type="button" className={'co-tag sm' + (sel.includes(t.cle) ? ' on' : '')} onClick={() => bascule(t.cle)} title="Filtrer sur cette compétence">{t.label}</button>)}</span> : (x.competences || '—')}</td>
                <td>{x.telephone ? <><a href={lienTel(x.telephone)} aria-label={'Appeler ' + x.nomComplet}>📞 {x.telephone}</a> <CopyBtn texte={x.telephone} label="Téléphone" notify={notify} /></> : <span className="co-hint">aucun n° enregistré</span>}</td>
                <td>{x.email ? <><a href={'mailto:' + x.email}>{x.email}</a> <CopyBtn texte={x.email} label="E-mail" notify={notify} /></> : '—'}</td>
                <td className="n">{x.parts}</td>
              </tr>))}
            {vue.length === 0 ? <tr><td colSpan={6} className="co-hint" style={{ padding: 18 }}>{fiches.length === 0 ? 'Aucun coopérateur dans l’annuaire pour l’instant : il se remplit à la validation des souscriptions dont le formulaire contient un métier ou des compétences et un accord « Oui ».' : 'Aucun résultat pour ces filtres.'}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const AN_CSS = `
.co-tags{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0}
.co-tags.tight{margin:0;gap:4px}
.co-tag{appearance:none;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;padding:3px 10px;font:inherit;font-size:12px;cursor:pointer}
.co-tag small{color:var(--muted);margin-left:2px}
.co-tag.sm{padding:1px 8px;font-size:11.5px}
.co-tag:hover{border-color:var(--muted)}
.co-tag.on{background:#012735;color:#fff;border-color:#012735}.co-tag.on small{color:#D6AD00}
.co-tag:focus-visible{outline:2px solid #D6AD00;outline-offset:1px}
`;
