'use client';
// app/admin/users/UsersAdmin.tsx : utilisateurs (invitations, statuts, rôle, mot de passe, suspension, suppression)
// et gestion des rôles (matrice des droits par application). Charte La Badjawe : #012735 et #D6AD00.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRole, deleteRole, deleteUser, inviteUser, resendInvite, resetPassword, setRole, setRolePermission, setSuspended, setTemporaryPassword } from './actions';
import { APP_KEYS, LEVELS, type AppKey, type Level, type Result } from '@/lib/types';

export type UserStatus = 'active' | 'pending' | 'suspended' | 'unknown';
export type UserRow = { id: string; email: string; name: string; role: string; hasProfile: boolean; last: string | null; created: string | null; status: UserStatus };
export type RoleRow = { id: string; name: string; description: string; isSystem: boolean; perms: Record<AppKey, Level> };
type Toast = { id: number; ok: boolean; msg: string };
type Tab = 'users' | 'roles';

const APP_LABEL: Record<AppKey, string> = { calculateur: 'Recette (calculateur)', budget: 'Budget', analyse: 'Reporting (analyse)' };
const LEVEL_LABEL: Record<Level, string> = { none: 'Aucun', read: 'Lecture seule', write: 'Modification complète' };

const BTN = 'inline-flex h-8 items-center justify-center whitespace-nowrap rounded border border-[#012735]/20 bg-white px-3 text-[13px] text-[#012735] hover:border-[#012735]/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#D6AD00] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_PRIMARY = 'inline-flex h-8 items-center justify-center whitespace-nowrap rounded border border-[#D6AD00] bg-[#D6AD00] px-3 text-[13px] font-semibold text-[#012735] hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#012735] disabled:cursor-not-allowed disabled:opacity-50';
const BTN_DANGER = 'inline-flex h-8 items-center justify-center whitespace-nowrap rounded border border-[#A22E22]/40 bg-white px-3 text-[13px] text-[#A22E22] hover:bg-[#F7DDD8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#A22E22] disabled:cursor-not-allowed disabled:opacity-50';
const FIELD = 'h-9 w-full rounded border border-[#012735]/25 bg-white px-3 text-[13px] text-[#012735] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D6AD00]';
const SELECT = 'h-8 rounded border border-[#012735]/25 bg-white px-2 text-[13px] text-[#012735] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D6AD00] disabled:opacity-60';

/** Date locale formatée uniquement après le montage : le rendu serveur et le premier rendu client sont identiques (pas d'erreur d'hydratation #418). */
function LocalDate({ iso }: { iso: string | null }) {
  const [text, setText] = useState<string>('');
  useEffect(() => {
    if (!iso) { setText('—'); return; }
    const d = new Date(iso);
    setText(Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }));
  }, [iso]);
  return <span suppressHydrationWarning>{text || (iso ? '…' : '—')}</span>;
}

function Badge({ tone, children, title }: { tone: 'gold' | 'red' | 'blue' | 'grey'; children: React.ReactNode; title?: string }) {
  const cls = tone === 'gold' ? 'bg-[#F7ECBD] text-[#7A6100]' : tone === 'red' ? 'bg-[#F7DDD8] text-[#A22E22]' : tone === 'blue' ? 'bg-[#012735] text-[#D6AD00]' : 'bg-[#EDF0E6] text-[#4A626C]';
  return <span title={title} className={'ml-2 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold ' + cls}>{children}</span>;
}

export default function UsersAdmin({ users: initialUsers, roles: initialRoles, rolesReady, currentUserId, hasServiceKey, warnings }: {
  users: UserRow[]; roles: RoleRow[]; rolesReady: boolean; currentUserId: string; hasServiceKey: boolean; warnings: string[];
}) {
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [roles, setRoles] = useState<RoleRow[]>(initialRoles);
  const [q, setQ] = useState<string>('');
  const [roleF, setRoleF] = useState<string>('');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef<number>(0);
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [link, setLink] = useState<{ id: string; url: string; msg: string } | null>(null);
  const [tmp, setTmp] = useState<string>('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState<boolean>(false);
  const [inv, setInv] = useState<{ email: string; name: string; role: string }>({ email: '', name: '', role: 'user' });
  const [nr, setNr] = useState<{ id: string; name: string; description: string }>({ id: '', name: '', description: '' });
  const firstField = useRef<HTMLInputElement | null>(null);

  const toast = useCallback((r: { ok: boolean; message: string }): void => {
    const id = ++toastId.current;
    setToasts((l: Toast[]) => [...l.slice(-3), { id, ok: r.ok, msg: r.message }]);
    setTimeout(() => setToasts((l: Toast[]) => l.filter((t: Toast) => t.id !== id)), r.ok ? 6000 : 9000);
  }, []);
  const run = async (key: string, fn: () => Promise<Result>): Promise<Result> => {
    setBusy((b: Record<string, boolean>) => ({ ...b, [key]: true }));
    let r: Result;
    try { r = await fn(); } catch (e: unknown) { r = { ok: false, message: e instanceof Error ? e.message : 'Erreur réseau' }; }
    toast(r);
    setBusy((b: Record<string, boolean>) => ({ ...b, [key]: false }));
    return r;
  };

  useEffect(() => {
    if (!inviteOpen) return;
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setInviteOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inviteOpen]);

  /* ---- utilisateurs ---- */
  const patchUser = (id: string, patch: Partial<UserRow>): void => setUsers((l: UserRow[]) => l.map((u: UserRow) => (u.id === id ? { ...u, ...patch } : u)));

  const changeRole = async (u: UserRow, role: string): Promise<void> => {
    if (role === u.role) return;
    const prev = u.role;
    patchUser(u.id, { role });
    const r = await run('r' + u.id, () => setRole(u.id, role));
    if (!r.ok) patchUser(u.id, { role: prev });
  };
  const toggleSuspend = async (u: UserRow): Promise<void> => {
    const to = u.status !== 'suspended';
    const r = await run('s' + u.id, () => setSuspended(u.id, to));
    if (r.ok) patchUser(u.id, { status: to ? 'suspended' : 'active' });
  };
  const removeUser = async (u: UserRow): Promise<void> => {
    setConfirm(null);
    const r = await run('d' + u.id, () => deleteUser(u.id));
    if (r.ok) setUsers((l: UserRow[]) => l.filter((x: UserRow) => x.id !== u.id));
  };
  const resend = async (u: UserRow): Promise<void> => {
    setLink(null);
    const r = await run('i' + u.id, () => resendInvite(u.id));
    if (r.ok && r.link) { setPwFor(u.id); setLink({ id: u.id, url: r.link, msg: r.message }); }
  };
  const reset = async (u: UserRow, mode: 'email' | 'link'): Promise<void> => {
    setLink(null);
    const r = await run('p' + u.id, () => resetPassword(u.id, mode));
    if (r.ok && r.link) setLink({ id: u.id, url: r.link, msg: r.message });
  };
  const copy = async (text: string): Promise<void> => {
    try { await navigator.clipboard.writeText(text); toast({ ok: true, message: 'Lien copié.' }); }
    catch { toast({ ok: false, message: 'Copie impossible : sélectionnez le lien et copiez-le à la main.' }); }
  };
  const submitInvite = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const r = await run('invite', () => inviteUser(inv));
    if (r.ok) {
      setInviteOpen(false);
      setInv({ email: '', name: '', role: 'user' });
      // la fiche est créée côté serveur : on l'affiche tout de suite (l'identifiant réel arrive au prochain chargement)
      setUsers((l: UserRow[]) => (l.some((u: UserRow) => u.email.toLowerCase() === inv.email.trim().toLowerCase()) ? l : [...l, { id: 'new-' + inv.email.trim().toLowerCase(), email: inv.email.trim().toLowerCase(), name: inv.name.trim(), role: inv.role, hasProfile: true, last: null, created: null, status: 'pending' }]));
    }
  };

  /* ---- rôles ---- */
  const changeLevel = async (role: RoleRow, app: AppKey, level: Level): Promise<void> => {
    if (role.perms[app] === level) return;
    const prev = role.perms[app];
    const set = (lv: Level): void => setRoles((l: RoleRow[]) => l.map((r: RoleRow) => (r.id === role.id ? { ...r, perms: { ...r.perms, [app]: lv } } : r)));
    set(level);
    const r = await run('l' + role.id + app, () => setRolePermission(role.id, app, level));
    if (!r.ok) set(prev);
  };
  const submitRole = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const r = await run('newrole', () => createRole(nr));
    if (r.ok) {
      const id = nr.id.trim().toLowerCase();
      setRoles((l: RoleRow[]) => [...l, { id, name: nr.name.trim(), description: nr.description.trim(), isSystem: false, perms: { calculateur: 'none', budget: 'none', analyse: 'none' } }]);
      setNr({ id: '', name: '', description: '' });
    }
  };
  const removeRole = async (role: RoleRow): Promise<void> => {
    setConfirm(null);
    const r = await run('x' + role.id, () => deleteRole(role.id));
    if (r.ok) setRoles((l: RoleRow[]) => l.filter((x: RoleRow) => x.id !== role.id));
  };

  const shown = useMemo<UserRow[]>(() => {
    const n = q.trim().toLowerCase();
    return users.filter((u: UserRow) => (!roleF || u.role === roleF) && (!n || (u.name + ' ' + u.email).toLowerCase().includes(n)));
  }, [users, q, roleF]);
  const countByRole = useMemo<Record<string, number>>(() => { const c: Record<string, number> = {}; users.forEach((u: UserRow) => { c[u.role] = (c[u.role] || 0) + 1; }); return c; }, [users]);
  const nAdmin = countByRole.admin || 0;
  const nPending = users.filter((u: UserRow) => u.status === 'pending').length;
  const roleOptions = (current: string): RoleRow[] => (roles.some((r: RoleRow) => r.id === current) ? roles : [...roles, { id: current, name: current, description: '', isSystem: false, perms: { calculateur: 'none', budget: 'none', analyse: 'none' } }]);

  const tabCls = (t: Tab): string => 'h-10 rounded-t border-b-[3px] px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D6AD00] ' + (tab === t ? 'border-[#D6AD00] text-[#012735]' : 'border-transparent text-[#4A626C] hover:text-[#012735]');

  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-3 p-4 text-[#012735]">
      <section className="rounded-md border border-[#012735]/15 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="m-0 text-[22px] font-semibold">Administration</h1>
            <p className="m-0 mt-0.5 text-[13px] text-[#4A626C]">
              {users.length} compte{users.length > 1 ? 's' : ''} · {nAdmin} administrateur{nAdmin > 1 ? 's' : ''}{nPending ? ` · ${nPending} invitation${nPending > 1 ? 's' : ''} en attente` : ''}
            </p>
          </div>
          <button type="button" className={BTN_PRIMARY} onClick={() => setInviteOpen(true)}>+ Inviter un utilisateur</button>
        </div>
        <div role="tablist" aria-label="Sections de l’administration" className="mt-3 flex gap-1 border-b border-[#012735]/15">
          <button type="button" role="tab" id="tab-users" aria-selected={tab === 'users'} aria-controls="panel-users" className={tabCls('users')} onClick={() => setTab('users')}>Utilisateurs</button>
          <button type="button" role="tab" id="tab-roles" aria-selected={tab === 'roles'} aria-controls="panel-roles" className={tabCls('roles')} onClick={() => setTab('roles')}>Gestion des rôles</button>
        </div>
      </section>

      {!hasServiceKey ? (
        <div role="note" className="rounded-md border border-[#8F5C00] bg-[#FBEED0] px-3.5 py-2.5 text-[13px]">
          <b>Clé de service absente.</b> Ajoutez <code>SUPABASE_SERVICE_ROLE_KEY</code> aux variables d’environnement (Vercel) puis redéployez : sans elle, les invitations, suspensions, suppressions, liens de réinitialisation et statuts des comptes ne sont pas disponibles. L’envoi de l’e-mail de réinitialisation fonctionne déjà.
        </div>
      ) : null}
      {warnings.map((w: string) => <div key={w} role="alert" className="rounded-md border border-[#A22E22] bg-[#F7DDD8] px-3.5 py-2.5 text-[13px]">{w}</div>)}

      {tab === 'users' ? (
        <section id="panel-users" role="tabpanel" aria-labelledby="tab-users" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input type="search" className={FIELD + ' max-w-xs'} aria-label="Rechercher un utilisateur" placeholder="Rechercher (nom, e-mail)…" value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} />
            <select className={SELECT + ' h-9'} aria-label="Filtrer par rôle" value={roleF} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRoleF(e.target.value)}>
              <option value="">Tous les rôles</option>
              {roles.map((r: RoleRow) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="overflow-auto rounded-md border border-[#012735]/15 bg-white">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-[#012735] text-left text-xs text-white">
                  <th scope="col" className="px-3 py-2 font-semibold">Utilisateur</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Rôle</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Dernière connexion</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((u: UserRow) => {
                  const self = u.id === currentUserId;
                  const label = u.name || u.email || u.id.slice(0, 8);
                  return (
                    <React.Fragment key={u.id}>
                      <tr className="border-t border-[#012735]/15 align-top">
                        <td className="px-3 py-2.5">
                          <div className="font-semibold">
                            {label}
                            {self ? <Badge tone="gold">vous</Badge> : null}
                            {u.status === 'pending' ? <Badge tone="gold" title="Le compte n’a pas encore été validé par l’utilisateur">Invitation en attente</Badge> : null}
                            {u.status === 'suspended' ? <Badge tone="red" title="Connexion bloquée">Suspendu</Badge> : null}
                            {!u.hasProfile ? <Badge tone="red" title="Ce compte n’a pas de ligne dans la table profiles">sans profil</Badge> : null}
                          </div>
                          {u.name && u.email ? <div className="break-all text-xs text-[#4A626C]">{u.email}</div> : null}
                        </td>
                        <td className="px-3 py-2.5">
                          <select className={SELECT} aria-label={`Rôle de ${label}`} value={u.role} disabled={!u.hasProfile || self || busy['r' + u.id]} title={self ? 'Vous ne pouvez pas modifier votre propre rôle' : ''} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => changeRole(u, e.target.value)}>
                            {roleOptions(u.role).map((r: RoleRow) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5"><LocalDate iso={u.last} /></td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1.5">
                            {u.status === 'pending' ? <button type="button" className={BTN_PRIMARY} disabled={!hasServiceKey || busy['i' + u.id]} onClick={() => resend(u)}>Renvoyer l’invitation</button> : null}
                            <button type="button" className={BTN} aria-expanded={pwFor === u.id} onClick={() => { setPwFor(pwFor === u.id ? null : u.id); setLink(null); setTmp(''); }}>Mot de passe…</button>
                            <button type="button" className={BTN} disabled={self || !hasServiceKey || busy['s' + u.id]} title={self ? 'Vous ne pouvez pas suspendre votre propre compte' : ''} onClick={() => toggleSuspend(u)}>{u.status === 'suspended' ? 'Réactiver' : 'Suspendre'}</button>
                            {confirm === 'u' + u.id ? (
                              <>
                                <button type="button" className={BTN_DANGER} disabled={busy['d' + u.id]} onClick={() => removeUser(u)}>Confirmer la suppression</button>
                                <button type="button" className={BTN} onClick={() => setConfirm(null)}>Annuler</button>
                              </>
                            ) : (
                              <button type="button" className={BTN_DANGER} disabled={self || !hasServiceKey} title={self ? 'Vous ne pouvez pas supprimer votre propre compte' : ''} onClick={() => setConfirm('u' + u.id)}>Supprimer</button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {pwFor === u.id ? (
                        <tr className="bg-[#FAF8EC]">
                          <td colSpan={4} className="px-3 py-3">
                            <div className="flex flex-col gap-2.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <button type="button" className={BTN_PRIMARY} disabled={(!u.email && !hasServiceKey) || busy['p' + u.id]} onClick={() => reset(u, 'email')}>Envoyer l’e-mail de réinitialisation</button>
                                <button type="button" className={BTN} disabled={!hasServiceKey || busy['p' + u.id]} onClick={() => reset(u, 'link')}>Générer un lien sécurisé</button>
                              </div>
                              {link && link.id === u.id ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs text-[#4A626C]">{link.msg}</span>
                                  <input className={FIELD + ' max-w-xl font-mono text-xs'} type="text" readOnly aria-label="Lien de réinitialisation" value={link.url} onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select()} />
                                  <button type="button" className={BTN} onClick={() => copy(link.url)}>Copier</button>
                                </div>
                              ) : null}
                              <div className="flex flex-wrap items-center gap-2">
                                <input className={FIELD + ' max-w-xs'} type="password" autoComplete="new-password" aria-label="Mot de passe temporaire" placeholder="Mot de passe temporaire (8 caractères min.)" value={tmp} disabled={!hasServiceKey} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTmp(e.target.value)} />
                                <button type="button" className={BTN} disabled={!hasServiceKey || tmp.length < 8 || busy['p' + u.id]} onClick={async () => { const r = await run('p' + u.id, () => setTemporaryPassword(u.id, tmp)); if (r.ok) setTmp(''); }}>Définir ce mot de passe</button>
                              </div>
                              <p className="m-0 text-xs text-[#4A626C]">L’e-mail et le lien mènent à la page « Nouveau mot de passe » où l’utilisateur choisit lui-même son mot de passe. Un mot de passe temporaire remplace immédiatement l’ancien.</p>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
                {!shown.length ? <tr><td colSpan={4} className="px-3 py-8 text-center text-[#4A626C]">Aucun utilisateur ne correspond.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section id="panel-roles" role="tabpanel" aria-labelledby="tab-roles" className="flex flex-col gap-3">
          {!rolesReady ? <div role="note" className="rounded-md border border-[#8F5C00] bg-[#FBEED0] px-3.5 py-2.5 text-[13px]">La gestion des rôles nécessite <code>sql/05_roles_permissions.sql</code>. Tant qu’il n’est pas exécuté, les modifications ci-dessous seront refusées.</div> : null}
          <p className="m-0 text-[13px] text-[#4A626C]">Pour chaque rôle, choisissez le niveau d’accès à chaque application : <b>Aucun</b> (l’application disparaît), <b>Lecture seule</b> ou <b>Modification complète</b>. Les droits s’appliquent immédiatement, jusque dans la base de données.</p>
          {roles.map((role: RoleRow) => (
            <article key={role.id} className="rounded-md border border-[#012735]/15 bg-white p-4" aria-label={`Rôle ${role.name}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="m-0 text-base font-semibold">
                    {role.name}
                    <span className="ml-2 rounded bg-[#EDF0E6] px-1.5 py-0.5 font-mono text-[11px] font-normal text-[#4A626C]">{role.id}</span>
                    {role.isSystem ? <Badge tone="grey">système</Badge> : null}
                  </h2>
                  {role.description ? <p className="m-0 mt-0.5 text-[13px] text-[#4A626C]">{role.description}</p> : null}
                  <p className="m-0 mt-0.5 text-xs text-[#4A626C]">{countByRole[role.id] || 0} utilisateur{(countByRole[role.id] || 0) > 1 ? 's' : ''}</p>
                </div>
                {!role.isSystem ? (
                  confirm === 'r' + role.id ? (
                    <div className="flex gap-1.5">
                      <button type="button" className={BTN_DANGER} disabled={busy['x' + role.id]} onClick={() => removeRole(role)}>Confirmer la suppression</button>
                      <button type="button" className={BTN} onClick={() => setConfirm(null)}>Annuler</button>
                    </div>
                  ) : <button type="button" className={BTN_DANGER} onClick={() => setConfirm('r' + role.id)}>Supprimer ce rôle</button>
                ) : null}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {APP_KEYS.map((app: AppKey) => (
                  <fieldset key={app} className="m-0 min-w-0 rounded border border-[#012735]/15 p-2.5" disabled={role.id === 'admin'}>
                    <legend className="px-1 text-xs font-semibold text-[#012735]">{APP_LABEL[app]}</legend>
                    <div className="flex flex-col gap-1">
                      {LEVELS.map((lv: Level) => (
                        <label key={lv} className={'flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] ' + (role.perms[app] === lv ? 'bg-[#F7ECBD] font-semibold' : 'hover:bg-[#EDF0E6]')}>
                          <input type="radio" className="h-4 w-4 accent-[#012735]" name={`perm-${role.id}-${app}`} checked={role.perms[app] === lv} disabled={role.id === 'admin' || busy['l' + role.id + app]} onChange={() => changeLevel(role, app, lv)} />
                          {LEVEL_LABEL[lv]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
              {role.id === 'admin' ? <p className="m-0 mt-2 text-xs text-[#4A626C]">Le rôle administrateur a toujours tous les droits (et seul lui accède à cette page).</p> : null}
            </article>
          ))}

          <form onSubmit={submitRole} className="rounded-md border border-dashed border-[#012735]/40 bg-white p-4" aria-label="Créer un rôle">
            <h2 className="m-0 mb-2 text-base font-semibold">Créer un rôle</h2>
            <div className="grid gap-2 sm:grid-cols-[180px_1fr_2fr_auto] sm:items-end">
              <label className="flex flex-col gap-1 text-xs font-semibold text-[#4A626C]">Identifiant technique
                <input className={FIELD + ' font-mono'} required pattern="[a-z][a-z0-9_]{1,30}" title="Minuscules, chiffres et _, commençant par une lettre" placeholder="ex. comptable" value={nr.id} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNr({ ...nr, id: e.target.value.toLowerCase() })} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[#4A626C]">Nom
                <input className={FIELD} required placeholder="ex. Comptable" value={nr.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNr({ ...nr, name: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[#4A626C]">Description
                <input className={FIELD} placeholder="À quoi sert ce rôle ?" value={nr.description} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNr({ ...nr, description: e.target.value })} />
              </label>
              <button type="submit" className={BTN_PRIMARY + ' h-9'} disabled={busy.newrole}>Créer</button>
            </div>
          </form>
        </section>
      )}

      {inviteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#012735]/60 p-4" onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) setInviteOpen(false); }}>
          <form role="dialog" aria-modal="true" aria-labelledby="inv-title" onSubmit={submitInvite} className="flex w-full max-w-md flex-col gap-3 rounded-lg border-t-4 border-[#D6AD00] bg-white p-5 shadow-xl">
            <h2 id="inv-title" className="m-0 text-lg font-semibold">Inviter un utilisateur</h2>
            <p className="m-0 text-[13px] text-[#4A626C]">Un e-mail d’invitation est envoyé : la personne choisit son mot de passe et accède aux applications selon son rôle.</p>
            <label className="flex flex-col gap-1 text-xs font-semibold text-[#4A626C]">Adresse e-mail
              <input ref={firstField} className={FIELD} type="email" required autoComplete="off" placeholder="prenom.nom@exemple.be" value={inv.email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInv({ ...inv, email: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-[#4A626C]">Nom complet
              <input className={FIELD} type="text" required autoComplete="off" value={inv.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInv({ ...inv, name: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-[#4A626C]">Rôle
              <select className={SELECT + ' h-9'} value={inv.role} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setInv({ ...inv, role: e.target.value })}>
                {roles.map((r: RoleRow) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            {!hasServiceKey ? <p role="alert" className="m-0 rounded bg-[#FBEED0] px-2.5 py-1.5 text-xs">Clé de service absente : l’invitation sera refusée tant que SUPABASE_SERVICE_ROLE_KEY n’est pas configurée.</p> : null}
            <div className="mt-1 flex justify-end gap-2">
              <button type="button" className={BTN} onClick={() => setInviteOpen(false)}>Annuler</button>
              <button type="submit" className={BTN_PRIMARY} disabled={busy.invite}>{busy.invite ? 'Envoi…' : 'Envoyer l’invitation'}</button>
            </div>
          </form>
        </div>
      ) : null}

      <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((t: Toast) => (
          <div key={t.id} className={'pointer-events-auto rounded-md border px-3.5 py-2.5 text-[13px] shadow-lg ' + (t.ok ? 'border-[#2F6B3C] bg-[#E2F0E4] text-[#2F6B3C]' : 'border-[#A22E22] bg-[#F7DDD8] text-[#A22E22]')}>{t.msg}</div>
        ))}
      </div>
    </main>
  );
}
