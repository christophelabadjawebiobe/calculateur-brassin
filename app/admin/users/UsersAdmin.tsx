'use client';
import React, { useMemo, useRef, useState, useEffect } from 'react';
import { resetPassword, setAccess, setRole, setTemporaryPassword, type Result } from './actions';

export type AppInfo = { id: string; name: string; route: string };
export type UserRow = { id: string; email: string; name: string; role: string; hasProfile: boolean; last: string | null; created: string | null; confirmed: boolean | null; access: string[] };

const ROLE_LABEL: Record<string, string> = { admin: 'Administrateur', brasseur: 'Brasseur', user: 'Utilisateur' };
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default function UsersAdmin({ users: initial, apps, currentUserId, hasServiceKey, warnings }: { users: UserRow[]; apps: AppInfo[]; currentUserId: string; hasServiceKey: boolean; warnings: string[] }) {
  const [mounted, setMounted] = useState(false);
  const [users, setUsers] = useState<UserRow[]>(initial);
  const [q, setQ] = useState('');
  const [roleF, setRoleF] = useState('');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [link, setLink] = useState<{ id: string; url: string; msg: string } | null>(null);
  const [tmp, setTmp] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const say = (r: Result | { ok: boolean; message: string }) => { 
    setToast({ ok: r.ok, msg: r.message }); 
    if (timer.current) clearTimeout(timer.current); 
    if (r.ok) timer.current = setTimeout(() => setToast(null), 6000); 
  };

  const run = async (key: string, fn: () => Promise<Result>) => {
    setBusy((b) => ({ ...b, [key]: true }));
    try { const r = await fn(); say(r); return r; }
    catch (e) { const r: Result = { ok: false, message: e instanceof Error ? e.message : 'Erreur' }; say(r); return r; }
    finally { setBusy((b) => ({ ...b, [key]: false })); }
  };

  const changeRole = async (u: UserRow, role: string) => {
    if (role === u.role || u.id === currentUserId) return;
    const prev = u.role;
    setUsers((l) => l.map((x) => (x.id === u.id ? { ...x, role } : x)));
    const r = await run('r' + u.id, () => setRole(u.id, role));
    if (!r.ok) setUsers((l) => l.map((x) => (x.id === u.id ? { ...x, role: prev } : x)));
  };

  const toggleApp = async (u: UserRow, a: AppInfo, on: boolean) => {
    setUsers((l) => l.map((x) => (x.id === u.id ? { ...x, access: on ? [...new Set([...x.access, a.id])] : x.access.filter((i) => i !== a.id) } : x)));
    const r = await run('a' + u.id + a.id, () => setAccess(u.id, a.id, on));
    if (!r.ok) setUsers((l) => l.map((x) => (x.id === u.id ? { ...x, access: on ? x.access.filter((i) => i !== a.id) : [...new Set([...x.access, a.id])] } : x)));
  };

  const reset = async (u: UserRow, mode: 'email' | 'link') => {
    setLink(null);
    const r = await run('p' + u.id, () => resetPassword(u.id, mode));
    if (r.ok && r.link) setLink({ id: u.id, url: r.link, msg: r.message });
  };

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return users.filter((u) => (!roleF || u.role === roleF) && (!n || (u.name + ' ' + u.email).toLowerCase().includes(n)));
  }, [users, q, roleF]);

  if (!mounted) {
    return <main className="max-w-7xl mx-auto p-4 text-slate-400">Chargement…</main>;
  }

  return (
    <main className="max-w-7xl mx-auto p-4 flex flex-col gap-4 text-[#012735]">
      <section className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
        <h1 className="text-xl font-bold">Utilisateurs</h1>
        <p className="text-sm text-slate-500">{users.length} comptes enregistrés.</p>
        <div className="flex flex-wrap gap-2 mt-3">
          <input type="search" placeholder="Rechercher..." value={q} onChange={(e) => setQ(e.target.value)} className="border border-slate-300 rounded px-3 py-1.5 text-sm" />
          <select value={roleF} onChange={(e) => setRoleF(e.target.value)} className="border border-slate-300 rounded px-3 py-1.5 text-sm">
            <option value="">Tous les rôles</option>
            {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </section>

      {toast && <div className={`p-3 rounded text-sm ${toast.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>{toast.msg}</div>}

      <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg shadow-sm">
        <table className="w-full text-left text-sm border-collapse">
          <thead className="bg-[#012735] text-white text-xs uppercase">
            <tr>
              <th className="p-3">Utilisateur</th>
              <th className="p-3">Rôle</th>
              <th className="p-3">Accès</th>
              <th className="p-3">Dernière connexion</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((u) => (
              <React.Fragment key={u.id}>
                <tr className="hover:bg-slate-50">
                  <td className="p-3">
                    <div className="font-semibold">{u.name || u.email}</div>
                    <div className="text-xs text-slate-400">{u.email}</div>
                  </td>
                  <td className="p-3">
                    <select value={u.role} disabled={u.id === currentUserId || busy['r' + u.id]} onChange={(e) => changeRole(u, e.target.value)} className="border border-slate-300 rounded p-1 text-sm bg-white">
                      {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td className="p-3">
                    {u.role === 'admin' ? <span className="text-xs text-slate-500">Toutes (admin)</span> : (
                      <div className="flex gap-2">
                        {apps.map((a) => (
                          <label key={a.id} className="text-xs inline-flex items-center gap-1">
                            <input type="checkbox" checked={u.access.includes(a.id)} onChange={(e) => toggleApp(u, a, e.target.checked)} />
                            {a.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-xs text-slate-600">{dt(u.last)}</td>
                  <td className="p-3">
                    <button type="button" onClick={() => setPwFor(pwFor === u.id ? null : u.id)} className="text-xs border border-slate-300 px-2 py-1 rounded hover:bg-slate-100">
                      Mot de passe
                    </button>
                  </td>
                </tr>
                {pwFor === u.id && (
                  <tr className="bg-amber-50/50">
                    <td colSpan={5} className="p-3">
                      <div className="flex flex-wrap gap-2 items-center">
                        <button type="button" onClick={() => reset(u, 'email')} className="text-xs bg-[#D6AD00] text-[#012735] font-semibold px-3 py-1.5 rounded hover:opacity-90">Envoyer l'e-mail</button>
                        <button type="button" onClick={() => reset(u, 'link')} className="text-xs border border-slate-300 px-3 py-1.5 rounded hover:bg-white">Lien direct</button>
                        <input type="password" placeholder="Mot de passe temporaire" value={tmp} onChange={(e) => setTmp(e.target.value)} className="text-xs border border-slate-300 rounded px-2 py-1" />
                        <button type="button" disabled={tmp.length < 8} onClick={async () => { const r = await run('p' + u.id, () => setTemporaryPassword(u.id, tmp)); if (r.ok) setTmp(''); }} className="text-xs bg-[#012735] text-white px-3 py-1.5 rounded disabled:opacity-40">Définir</button>
                      </div>
                      {link && link.id === u.id && (
                        <div className="mt-2 text-xs flex gap-2 items-center">
                          <input readOnly value={link.url} className="border border-slate-300 rounded p-1 w-96 font-mono text-xs" />
                          <button onClick={() => { navigator.clipboard.writeText(link.url); say({ ok: true, message: 'Copié' }); }} className="border border-slate-300 px-2 py-1 rounded">Copier</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
