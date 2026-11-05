'use client';
// app/apps/cooperateurs/JournalTab.tsx : onglet 6 « Journal / Audit » : historique des actions en base (table public.journal, sql/07 + sql/11)
// Lecture seule. Filtres : type d'événement, période, coopérateur, auteur. Les données sont chargées côté client (pas de formatage au rendu serveur).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Cooperateur } from '@/lib/cooperateurs/types';
import { fmtDateHeure, fmtMontant } from '@/lib/cooperateurs/numbers';
import { nomComplet } from './data';
import type { TabProps } from './CooperateursApp';

type Row = {
  id: number; horodatage: string; utilisateur: string | null; action: string | null; operation: string; table_nom: string | null;
  cooperateur_id: number | null; libelle: string | null; avant: Record<string, any> | null; apres: Record<string, any> | null;
  type_evenement: string; cooperateur_nom: string | null;
};
const PAGE = 100;
export const TYPES: [string, string][] = [
  ['import', 'Import Google Sheet'], ['souscription', 'Souscription / validation'], ['mouvement', 'Mouvement de parts (ajout / retrait)'],
  ['coordonnees', 'Modification de coordonnées'], ['fusion', 'Fusion de fiches'], ['doublons', 'Détection de doublons'], ['autre', 'Autre'],
];
const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPES);
const TYPE_CHIP: Record<string, string> = { import: 'gold', souscription: 'ok', mouvement: '', coordonnees: '', fusion: 'warn', doublons: 'warn', autre: '' };
const OP: Record<string, string> = { INSERT: 'Création', UPDATE: 'Modification', DELETE: 'Suppression', EVENEMENT: 'Événement' };
const IGNORES = new Set(['updated_at', 'created_at']);

/** résumé lisible d'une ligne du journal (sans afficher de données sensibles complètes : seuls les champs modifiés sont cités) */
export function detailDe(j: Row, valeurPart: number): string {
  const a = j.avant || {}, p = j.apres || {};
  if (j.table_nom === 'mouvements_parts') {
    const src = j.operation === 'DELETE' ? a : p; const n = Number(src.nombre_parts);
    if (Number.isFinite(n)) return `${j.operation === 'DELETE' ? 'Suppression de ' : ''}${n > 0 ? '+' : ''}${n} part(s) · ${fmtMontant(Number(src.montant_total ?? n * valeurPart))}${src.date_mouvement ? ' · ' + String(src.date_mouvement) : ''}`;
  }
  if (j.operation === 'UPDATE') {
    const ch = Object.keys(p).filter((k: string) => !IGNORES.has(k) && JSON.stringify(a[k]) !== JSON.stringify(p[k]));
    if (!ch.length) return '';
    const fmt = (v: any) => (v == null || v === '' ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    return ch.slice(0, 4).map((k: string) => `${k} : ${fmt(a[k])} → ${fmt(p[k])}`).join(' ; ') + (ch.length > 4 ? ` (+${ch.length - 4})` : '');
  }
  if (j.table_nom === 'contacts' && p.valeur) return `${p.type || 'contact'} : ${p.valeur}`;
  if (j.table_nom === 'contacts' && a.valeur) return `${a.type || 'contact'} : ${a.valeur}`;
  if (j.table_nom === 'adresses') { const s = j.operation === 'DELETE' ? a : p; return [s.rue, s.numero, s.code_postal, s.ville].filter(Boolean).join(' '); }
  return j.libelle || '';
}

export default function JournalTab({ store, notify, supabase }: TabProps) {
  const { coops, valeurPart, isAdmin, canWrite } = store;
  const [type, setType] = useState(''); const [du, setDu] = useState(''); const [au, setAu] = useState(''); const [auteur, setAuteur] = useState('');
  const [rech, setRech] = useState(''); const [coopId, setCoopId] = useState<number | null>(null);
  const [auteurs, setAuteurs] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]); const [plus, setPlus] = useState(false); const [charge, setCharge] = useState(false); const [erreur, setErreur] = useState('');

  const propositions = rech.trim().length >= 2 && coopId == null ? coops.filter((c: Cooperateur) => nomComplet(c).toLowerCase().includes(rech.trim().toLowerCase())).slice(0, 8) : [];
  const coopChoisie = coopId != null ? coops.find((c: Cooperateur) => c.id === coopId) || null : null;

  const requete = useCallback((from: number) => {
    let q = supabase.from('v_journal_evenements').select('id,horodatage,utilisateur,action,operation,table_nom,cooperateur_id,libelle,avant,apres,type_evenement,cooperateur_nom').order('id', { ascending: false }).range(from, from + PAGE - 1);
    if (type) q = q.eq('type_evenement', type);
    if (auteur) q = q.eq('utilisateur', auteur);
    if (coopId != null) q = q.eq('cooperateur_id', coopId);
    if (du) q = q.gte('horodatage', new Date(du + 'T00:00:00').toISOString());
    if (au) q = q.lte('horodatage', new Date(au + 'T23:59:59').toISOString());
    return q;
  }, [supabase, type, auteur, coopId, du, au]);

  const charger = useCallback(async (suite: boolean) => {
    setCharge(true);
    const r: any = await requete(suite ? rows.length : 0);
    setCharge(false);
    if (r.error) {
      const m: string = r.error.message || '';
      setErreur(/v_journal_evenements|schema cache|does not exist/i.test(m) ? 'La vue du journal n’existe pas encore : exécutez sql/11_cooperateurs_audit_mouvements.sql dans Supabase, puis rechargez la page.' : 'Lecture du journal impossible : ' + m);
      if (!suite) setRows([]); return;
    }
    setErreur(''); const d: Row[] = r.data || [];
    setRows((prev: Row[]) => (suite ? prev.concat(d) : d)); setPlus(d.length === PAGE);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requete, rows.length]);

  useEffect(() => { charger(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [type, auteur, coopId, du, au]);
  useEffect(() => { supabase.from('v_journal_utilisateurs').select('utilisateur').then((r: any) => { if (!r.error) setAuteurs((r.data || []).map((x: { utilisateur: string }) => x.utilisateur).sort()); }); }, [supabase]);
  const nomCoop = useMemo(() => { const m = new Map<number, string>(); coops.forEach((c: Cooperateur) => m.set(c.id, nomComplet(c))); return m; }, [coops]);
  const reinit = () => { setType(''); setDu(''); setAu(''); setAuteur(''); setRech(''); setCoopId(null); };
  void notify;

  return (
    <>
      <div className="co-bar" role="search" aria-label="Filtres du journal">
        <select aria-label="Type d’événement" value={type} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setType(e.target.value)}><option value="">Tous les événements</option>{TYPES.map((t: [string, string]) => <option key={t[0]} value={t[0]}>{t[1]}</option>)}</select>
        <label className="co-hint">Du <input type="date" aria-label="Du" value={du} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDu(e.target.value)} style={{ height: 36 }} /></label>
        <label className="co-hint">au <input type="date" aria-label="Au" value={au} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAu(e.target.value)} style={{ height: 36 }} /></label>
        <select aria-label="Auteur" value={auteur} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAuteur(e.target.value)}><option value="">Tous les auteurs</option>{auteurs.map((a: string) => <option key={a} value={a}>{a}</option>)}</select>
        <span style={{ position: 'relative' }}>
          <input type="search" aria-label="Coopérateur concerné" placeholder="Coopérateur concerné…" value={coopChoisie ? nomComplet(coopChoisie) : rech} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setRech(e.target.value); setCoopId(null); }} autoComplete="off" />
          {propositions.length ? <div className="co-wrap" style={{ position: 'absolute', zIndex: 5, top: 38, left: 0, minWidth: 260, maxHeight: 220 }}><table className="co-tbl"><tbody>{propositions.map((c: Cooperateur) => <tr key={c.id} className="sel" tabIndex={0} onClick={() => setCoopId(c.id)} onKeyDown={(e: React.KeyboardEvent<HTMLTableRowElement>) => { if (e.key === 'Enter') setCoopId(c.id); }}><td>{nomComplet(c)}</td></tr>)}</tbody></table></div> : null}
        </span>
        <button type="button" className="co-btn" onClick={reinit}>Réinitialiser</button>
        <button type="button" className="co-btn" onClick={() => charger(false)}>↻ Actualiser</button>
        <span className="co-hint">{rows.length} entrée{rows.length > 1 ? 's' : ''}{plus ? ' (il y en a d’autres)' : ''}</span>
      </div>
      {erreur ? <p className="co-msg bad" role="alert">{erreur}</p> : null}
      <div className="co-wrap">
        <table className="co-tbl">
          <thead><tr><th>Date / heure</th><th>Événement</th><th>Coopérateur</th><th>Détail</th><th>Auteur</th></tr></thead>
          <tbody>
            {rows.map((j: Row) => (
              <tr key={j.id}>
                <td>{fmtDateHeure(j.horodatage)}</td>
                <td><span className={'co-chip ' + (TYPE_CHIP[j.type_evenement] || '')}>{TYPE_LABEL[j.type_evenement] || j.type_evenement}</span><div className="co-hint">{j.action || (OP[j.operation] || j.operation) + ' · ' + (j.table_nom || '')}</div></td>
                <td>{j.cooperateur_id != null ? (nomCoop.get(j.cooperateur_id) || j.cooperateur_nom || '#' + j.cooperateur_id) : (j.cooperateur_nom || '—')}</td>
                <td>{detailDe(j, valeurPart)}</td>
                <td>{j.utilisateur || '—'}</td>
              </tr>))}
            {!charge && !erreur && rows.length === 0 ? <tr><td colSpan={5} className="co-hint" style={{ padding: 18 }}>{isAdmin || canWrite ? 'Aucune entrée pour ces filtres.' : 'Le journal est réservé aux administrateurs et aux utilisateurs ayant le droit d’écriture sur les Coopérateurs.'}</td></tr> : null}
            {charge ? <tr><td colSpan={5} className="co-hint" style={{ padding: 18 }} role="status">Chargement…</td></tr> : null}
          </tbody>
        </table>
      </div>
      {plus && !charge ? <div className="co-acts"><button type="button" className="co-btn" onClick={() => charger(true)}>Charger les {PAGE} entrées suivantes</button></div> : null}
      <p className="co-hint">Le journal est en lecture seule : chaque import, validation, mouvement de parts, modification de coordonnées, fusion et détection de doublons y est consigné automatiquement par la base, avec l’auteur connecté.</p>
    </>
  );
}
