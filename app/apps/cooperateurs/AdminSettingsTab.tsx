'use client';
// app/apps/cooperateurs/AdminSettingsTab.tsx : onglet « Paramètres » (administrateurs uniquement)
//   1. Mode Démo : bouton TEMPORAIRE pour projeter l'écran en réunion (masquage à l'écran, rien n'est écrit en base, désactivé au rechargement).
//   2. Droits d'accès au module : niveau de chaque rôle (Aucun / Vue anonymisée / Lecture / Modification) et affectation des utilisateurs aux rôles.
//      Le niveau « Vue anonymisée » est appliqué par la BASE (sql/16) : le rôle ne reçoit que des données déjà masquées, sans possibilité de lever le masquage.
//   Aucune fonction de cette page n'écrit, n'écrase ni ne supprime de données de coopérateurs.
import React, { useCallback, useEffect, useState } from 'react';
import { setRole, setRolePermission } from '@/app/admin/users/actions';
import type { TabProps } from './CooperateursApp';

type RoleLigne = { id: string; name: string; niveau: string };
type UserLigne = { id: string; email: string; nom: string; role: string };
const NIVEAUX: [string, string][] = [['none', 'Aucun accès'], ['anon', 'Vue anonymisée (lecture seule, données personnelles masquées)'], ['read', 'Lecture seule (données en clair)'], ['write', 'Modification complète (données en clair, édition, exports)']];
const ROLE_ANON = 'coop_anonyme';

export default function AdminSettingsTab({ store, notify, supabase, demo, setDemo }: TabProps & { demo: boolean; setDemo: (v: boolean) => void }) {
  const [roles, setRoles] = useState<RoleLigne[] | null>(null);
  const [users, setUsers] = useState<UserLigne[] | null>(null);
  const [erreur, setErreur] = useState(''); const [busy, setBusy] = useState('');

  const charger = useCallback(async () => {
    const [r, p, u] = await Promise.all([
      supabase.from('roles').select('id,name').order('name'),
      supabase.from('role_permissions').select('role_id,level').eq('app_key', 'cooperateurs'),
      supabase.from('profiles').select('id,email,full_name,role').order('email'),
    ]);
    if (r.error || p.error) { setErreur('Rôles indisponibles : ' + ((r.error || p.error).message || '')); return; }
    const niv = new Map<string, string>(); (p.data || []).forEach((x: any) => niv.set(x.role_id, x.level));
    setRoles((r.data || []).map((x: any) => ({ id: x.id, name: x.name, niveau: niv.get(x.id) || 'none' })));
    setUsers(u.error ? null : (u.data || []).map((x: any) => ({ id: x.id, email: x.email || '', nom: x.full_name || '', role: x.role || '' })));
    setErreur('');
  }, [supabase]);
  useEffect(() => { if (store.isAdmin) charger(); }, [store.isAdmin, charger]);

  if (!store.isAdmin) return <p className="co-msg bad" role="alert">Cette page est réservée aux administrateurs.</p>;

  const changerNiveau = async (r: RoleLigne, niveau: string) => {
    if (niveau === r.niveau) return;
    setBusy('n' + r.id);
    const j = await setRolePermission(r.id, 'cooperateurs', niveau);
    setBusy('');
    notify(j.message, j.ok ? 'ok' : 'bad');
    if (j.ok) setRoles((l: RoleLigne[] | null) => (l || []).map((x: RoleLigne) => (x.id === r.id ? { ...x, niveau } : x)));
  };
  const changerRole = async (u: UserLigne, role: string) => {
    if (role === u.role) return;
    setBusy('u' + u.id);
    const j = await setRole(u.id, role);
    setBusy('');
    notify(j.message, j.ok ? 'ok' : 'bad');
    if (j.ok) setUsers((l: UserLigne[] | null) => (l || []).map((x: UserLigne) => (x.id === u.id ? { ...x, role } : x)));
  };
  const niveauDe = (id: string): string => ((roles || []).find((r: RoleLigne) => r.id === id) || { niveau: 'none' }).niveau;
  const libelleNiveau = (n: string): string => ({ none: 'Aucun accès', anon: 'Vue anonymisée', read: 'Lecture', write: 'Modification' } as Record<string, string>)[n] || n;
  const rolesDispo = (roles || []);

  return (
    <>
      <section className="co-card" aria-labelledby="st-demo">
        <h2 id="st-demo">Mode Démo (présentation en réunion)</h2>
        <p className="co-hint">Bouton temporaire pour projeter l’écran : masque les noms, e-mails, téléphones, numéros, rues, métiers et bénéficiaires (ex. « J*** D*** », « j****@badjawe.be »). Les montants, parts et certificats restent visibles. <b>Aucune donnée n’est modifiée</b> ; l’application passe en lecture seule et le mode se désactive au rechargement de la page.</p>
        <div className="co-acts"><button type="button" className={'co-btn' + (demo ? ' primary' : '')} aria-pressed={demo} onClick={() => setDemo(!demo)}>🕶 {demo ? 'Désactiver le mode démo' : 'Activer le mode démo'}</button></div>
      </section>

      <section className="co-card" aria-labelledby="st-droits">
        <h2 id="st-droits">Droits d’accès : rôle « Vue coopérateurs anonymisée »</h2>
        <p className="co-hint">Un utilisateur dont le rôle est au niveau <b>Vue anonymisée</b> consulte les chiffres, statistiques, mouvements et certificats, mais ne reçoit <b>jamais</b> de données personnelles : le masquage est fait par la base avant l’envoi, il ne peut pas être levé depuis le navigateur. Il n’a aucun bouton de modification, d’export en clair, de journal, de doublons ni de paramètres.</p>
        {erreur ? <p className="co-msg bad" role="alert">{erreur}</p> : null}
        {roles && !roles.some((r: RoleLigne) => r.id === ROLE_ANON) ? <p className="co-msg info" role="note">Le rôle « Vue coopérateurs anonymisée » n’existe pas encore : exécutez <code>sql/16_cooperateurs_vue_anonymisee.sql</code> dans Supabase (ou créez un rôle dans Admin &gt; Rôles et choisissez « Vue anonymisée »).</p> : null}

        <h3>Niveau d’accès de chaque rôle</h3>
        <div className="co-wrap"><table className="co-tbl">
          <thead><tr><th>Rôle</th><th>Niveau dans « Coopérateurs »</th></tr></thead>
          <tbody>
            {rolesDispo.map((r: RoleLigne) => (
              <tr key={r.id}>
                <td><b>{r.name}</b> <span className="co-hint">({r.id})</span></td>
                <td>{r.id === 'admin' ? <span className="co-chip ok">Accès complet (toujours)</span> : (
                  <select aria-label={`Niveau du rôle ${r.name}`} value={r.niveau} disabled={busy === 'n' + r.id} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => changerNiveau(r, e.target.value)}>
                    {NIVEAUX.map((n: [string, string]) => <option key={n[0]} value={n[0]}>{n[1]}</option>)}
                  </select>)}</td>
              </tr>))}
            {roles && roles.length === 0 ? <tr><td colSpan={2} className="co-hint">Aucun rôle.</td></tr> : null}
            {!roles && !erreur ? <tr><td colSpan={2} className="co-hint" role="status">Chargement…</td></tr> : null}
          </tbody>
        </table></div>

        <h3>Utilisateurs et rôle affecté</h3>
        {users ? (
          <div className="co-wrap"><table className="co-tbl">
            <thead><tr><th>Utilisateur</th><th>Rôle</th><th>Accès Coopérateurs</th></tr></thead>
            <tbody>
              {users.map((u: UserLigne) => (
                <tr key={u.id}>
                  <td><b>{u.nom || u.email}</b>{u.nom ? <div className="co-hint">{u.email}</div> : null}</td>
                  <td><select aria-label={`Rôle de ${u.email || u.nom}`} value={u.role} disabled={busy === 'u' + u.id} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => changerRole(u, e.target.value)}>
                    {!rolesDispo.some((r: RoleLigne) => r.id === u.role) ? <option value={u.role}>{u.role || '—'}</option> : null}
                    {rolesDispo.map((r: RoleLigne) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select></td>
                  <td><span className={'co-chip' + (niveauDe(u.role) === 'anon' ? ' warn' : niveauDe(u.role) === 'none' && u.role !== 'admin' ? '' : ' ok')}>{u.role === 'admin' ? 'Accès complet' : libelleNiveau(niveauDe(u.role))}</span></td>
                </tr>))}
              {users.length === 0 ? <tr><td colSpan={3} className="co-hint">Aucun utilisateur.</td></tr> : null}
            </tbody>
          </table></div>
        ) : <p className="co-hint">La liste des utilisateurs n’est pas lisible ici : utilisez <a href="/admin/users">Admin &gt; Utilisateurs</a> pour affecter les rôles.</p>}
        <p className="co-hint">Invitations, suspension et mots de passe : <a href="/admin/users">Admin &gt; Utilisateurs</a>. Rien de cette page ne modifie, n’efface ni n’écrase les données des coopérateurs.</p>
      </section>
    </>
  );
}
