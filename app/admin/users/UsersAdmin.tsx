'use client';
// app/admin/users/UsersAdmin.tsx : liste des comptes, rôles, accès aux applications, réinitialisation du mot de passe
import React, { useMemo, useRef, useState, useEffect } from 'react';
import { resetPassword, setAccess, setRole, setTemporaryPassword, type Result } from './actions';

export type AppInfo = { id: string; name: string; route: string };
export type UserRow = { id: string; email: string; name: string; role: string; hasProfile: boolean; last: string | null; created: string | null; confirmed: boolean | null; access: string[] };

const ROLE_LABEL: Record<string, string> = { admin: 'Administrateur', brasseur: 'Brasseur', user: 'Utilisateur' };
const ROLE_HELP = 'Administrateur : tout, y compris cette page et la validation du budget. Brasseur : peut modifier (budget, recettes, réalisé) dans les applications autorisées. Utilisateur : consultation seule des applications autorisées.';
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '—');

const CSS = `
.ad-wrap{max-width:1280px;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:12px;color:var(--ink)}
.ad-card{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:14px 16px}
.ad-card h1{font-size:22px;margin:0 0 2px}
.ad-sub{font-size:13px;color:var(--muted);margin:0}
.ad-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}
.ad-bar input[type=search],.ad-bar select{height:34px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);padding:0 10px;font:inherit;font-size:13px}
.ad-bar input[type=search]{min-width:min(100%,280px)}
.ad-alert{background:var(--warn-soft);border:1px solid var(--warn);border-radius:6px;padding:10px 14px;font-size:13px}
.ad-alert.bad{background:var(--bad-soft);border-color:var(--bad)}
.ad-toast{position:sticky;top:96px;z-index:5;padding:10px 14px;border-radius:6px;font-size:13px;box-shadow:0 4px 14px rgba(1,39,53,.15)}
.ad-toast.ok{background:var(--good-soft);border:1px solid var(--good);color:var(--good)}
.ad-toast.ko{background:var(--bad-soft);border:1px solid var(--bad);color:var(--bad)}
.ad-scroll{overflow:auto;border:1px solid var(--line);border-radius:6px;background:var(--surface)}
.ad-tbl{border-collapse:collapse;width:100%;font-size:13px}
.ad-tbl th{background:var(--brand);color:#fff;text-align:left;font-weight:600;font-size:12px;padding:8px 12px;white-space:nowrap}
.ad-tbl td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
.ad-tbl tr.pw td{background:#FAF8EC}
.ad-name{font-weight:600}.ad-mail{color:var(--muted);font-size:12px;word-break:break-all}
.ad-badge{font-size:10.5px;font-weight:600;padding:1px 7px;border-radius:999px;background:var(--accent-soft);color:var(--accent-text);margin-left:6px}
.ad-badge.bad{background:var(--bad-soft);color:var(--bad)}
.ad-sel{height:32px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);padding:0 8px;font:inherit;font-size:13px}
.ad-apps{display:flex;flex-wrap:wrap;gap:6px 14px}
.ad-apps label{display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}
.ad-apps input{width:16px;height:16px;accent-color:var(--brand)}
.ad-btn{appearance:none;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:4px;height:32px;padding:0 12px;cursor:pointer;font:inherit;font-size:13px;white-space:nowrap}
.ad-btn:hover:not(:disabled){border-color:var(--muted)}
.ad-btn.primary{background:var(--brand-2);border-color:var(--brand-2);color:var(--brand);font-weight:600}
.ad-btn:disabled{opacity:.5;cursor:not-allowed}
.ad-btn:focus-visible,.ad-sel:focus-visible,.ad-apps input:focus-visible{outline:2px solid var(--brand-2);outline-offset:1px}
.ad-pw{display:flex;flex-direction:column;gap:10px}
.ad-pw-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ad-pw input[type=text],.ad-pw input[type=password]{height:32px;border:1px solid var(--line);border-radius:4px;padding:0 10px;font:inherit;font-size:13px;min-width:min(100%,320px);background:var(--surface);color:var(--ink)}
.ad-link{font-family:var(--font-mono,monospace);font-size:12px;width:min(100%,640px)}
.ad-help{font-size:12px;color:var(--muted);margin:0}
@media (max-width:760px){.ad-wrap{padding:12px}}
`;

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

  useEffect(() => {
    setMounted(true);
  }, []);

  const say = (r: Result | { ok: boolean; message: string }) => { 
    setToast({ ok: r.ok, msg: r.message }); 
    if (timer.current) clearTimeout(timer.current); 
    if (r.ok) timer.current = setTimeout(() => setToast(null), 6000); 
  };

  const run = async (key: string, fn: () => Promise<Result>) => {
    setBusy((b) => ({ ...b, [key]: true }));
    try { 
      const r = await fn(); 
      say(r); 
      return r; 
    } catch (e) { 
      const r: Result = { ok: false, message: e instanceof Error ? e.message : 'Erreur réseau' }; 
      say(r); 
      return r; 
    } finally { 
      setBusy((b) => ({ ...b, [key]: false })); 
    }
  };

  const changeRole = async (u: UserRow, role: string) => {
    if (role === u.role) return;
    if (u.id === currentUserId) { say({ ok: false, message: 'Vous ne pouvez pas modifier votre propre rôle.' }); return; }
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

  const copy = async (t: string) => { 
    try { 
      await navigator.clipboard.writeText(t); 
      say({ ok: true, message: 'Lien copié.' }); 
    } catch { 
      say({ ok: false, message: 'Copie impossible : sélectionnez le lien et copiez-le à la main.' }); 
    } 
  };

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return users.filter((u) => (!roleF || u.role === roleF) && (!n || (u.name + ' ' + u.email).toLowerCase().includes(n)));
  }, [users, q, roleF]);

  const nAdmin = users.filter((u) => u.role === 'admin').length;

  if (!mounted) {
    return (
      <main className="ad-wrap">
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <section className="ad-card">
          <h1>Utilisateurs</h1>
          <p className="ad-sub">Chargement des données utilisateurs…</p>
        </section>
      </main>
    );
  }

  return (
    <main className="ad-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <section className="ad-card">
        <h1>Utilisateurs</h1>
        <p className="ad-sub">{users.length} compte{users.length > 1 ? 's' : ''} · {nAdmin} administrateur{nAdmin > 1 ? 's' : ''}. Les modifications sont enregistrées immédiatement.</p>
        <div className="ad-bar">
          <input type="search" aria-label="Rechercher un utilisateur" placeholder="Rechercher (nom, e-mail)…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="Filtrer par rôle" value={roleF} onChange={(e) => setRoleF(e.target.value)}>
            <option value="">Tous les rôles</option>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <p className="ad-help" style={{ marginTop: 10 }}>{ROLE_HELP}</p>
      </section>

      {!hasServiceKey ? <div className="ad-alert" role="note"><b>Clé de service absente.</b> Ajoutez <code>SUPABASE_SERVICE_ROLE_KEY</code> aux variables d’environnement (Vercel) puis redéployez pour afficher les e-mails et dernières connexions, générer des liens de réinitialisation et définir un mot de passe. L’envoi de l’e-mail de réinitialisation fonctionne déjà sans elle.</div> : null}
      {warnings.map((w) => <div key={w} className="ad-alert bad" role="alert">{w} : exécutez <code>sql/04_admin_reel_validation.sql</code> dans Supabase (SQL Editor).</div>)}
      <div aria-live="polite" role="status">{toast ? <div className={'ad-toast ' + (toast.ok ? 'ok' : 'ko')}>{toast.msg}</div> : null}</div>

      <div className="ad-scroll">
        <table className="ad-tbl">
          <thead><tr><th scope="col">Utilisateur</th><th scope="col">Rôle</th><th scope="col">Accès aux applications</th><th scope="col">Dernière connexion</th><th scope="col">Mot de passe</th></tr></thead>
          <tbody>
            {shown.map((u) => (
              <React.Fragment key={u.id}>
                <tr>
                  <td>
                    <div className="ad-name">{u.name || u.email || u.id.slice(0, 8)}{u.id === currentUserId ? <span className="ad-badge">vous</span> : null}{!u.hasProfile ? <span className="ad-badge bad" title="Ce compte n’a pas de ligne dans la table profiles">sans profil</span> : null}{u.confirmed === false ? <span className="ad-badge bad" title="Adresse e-mail non confirmée">non confirmé</span> : null}</div>
                    {u.name && u.email ? <div className="ad-mail">{u.email}</div> : null}
                  </td>
                  <td>
                    <select className="ad-sel" aria-label={`Rôle de ${u.name || u.email}`} value={u.role} disabled={!u.hasProfile || u.id === currentUserId || busy['r' + u.id]} onChange={(e) => changeRole(u, e.target.value)} title={u.id === currentUserId ? 'Vous ne pouvez pas modifier votre propre rôle' : ''}>
                      {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      {!(u.role in ROLE_LABEL) ? <option value={u.role}>{u.role}</option> : null}
                    </select>
                  </td>
                  <td>
                    {u.role === 'admin' ? <span className="ad-sub">Toutes (administrateur)</span> : (
                      <div className="ad-apps" role="group" aria-label={`Applications de ${u.name || u.email}`}>
                        {apps.map((a) => <label key={a.id}><input type="checkbox" checked={u.access.includes(a.id)} disabled={busy['a' + u.id + a.id]} onChange={(e) => toggleApp(u, a, e.target.checked)} />{a.name}</label>)}
                        {!apps.length ? <span className="ad-sub">Aucune application</span> : null}
                      </div>)}
                  </td>
                  <td>{dt(u.last)}</td>
                  <td><button type="button" className="ad-btn" aria-expanded={pwFor === u.id} onClick={() => { setPwFor(pwFor === u.id ? null : u.id); setLink(null); setTmp(''); }}>Réinitialiser…</button></td>
                </tr>
                {pwFor === u.id ? (
                  <tr className="pw"><td colSpan={5}>
                    <div className="ad-pw">
                      <div className="ad-pw-row">
                        <button type="button" className="ad-btn primary" disabled={!u.email && !hasServiceKey || busy['p' + u.id]} onClick={() => reset(u, 'email')}>Envoyer l’e-mail de réinitialisation</button>
                        <button type="button" className="ad-btn" disabled={!hasServiceKey || busy['p' + u.id]} title={hasServiceKey ? '' : 'Nécessite SUPABASE_SERVICE_ROLE_KEY'} onClick={() => reset(u, 'link')}>Générer un lien à transmettre</button>
                      </div>
                      {link && link.id === u.id ? (
                        <div className="ad-pw-row"><span className="ad-help">{link.msg}</span>
                          <input className="ad-link" type="text" readOnly aria-label="Lien de réinitialisation" value={link.url} onFocus={(e) => e.currentTarget.select()} />
                          <button type="button" className="ad-btn" onClick={() => copy(link.url)}>Copier</button></div>) : null}
                      <div className="ad-pw-row">
                        <input type="password" autoComplete="new-password" aria-label="Mot de passe temporaire" placeholder="Mot de passe temporaire (8 caractères min.)" value={tmp} onChange={(e) => setTmp(e.target.value)} disabled={!hasServiceKey} />
                        <button type="button" className="ad-btn" disabled={!hasServiceKey || tmp.length < 8 || busy['p' + u.id]} onClick={async () => { const r = await run('p' + u.id, () => setTemporaryPassword(u.id, tmp)); if (r.ok) setTmp(''); }}>Définir ce mot de passe</button>
                      </div>
                      <p className="ad-help">L’e-mail et le lien mènent à la page « Nouveau mot de passe » où l’utilisateur choisit lui-même son mot de passe. Le mot de passe temporaire remplace immédiatement l’ancien : transmettez-le par un canal sûr.</p>
                    </div>
                  </td></tr>
                ) : null}
              </React.Fragment>
            ))}
            {!shown.length ? <tr><td colSpan={5} className="ad-sub" style={{ textAlign: 'center', padding: 24 }}>Aucun utilisateur ne correspond.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
