// app/admin/users/page.tsx : administration des utilisateurs et des rôles (réservée au rôle « admin »)
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { APP_KEYS, type AppKey, type Level } from '@/lib/types';
import AppHeader from '@/components/AppHeader';
import UsersAdmin, { type RoleRow, type UserRow } from './UsersAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin : utilisateurs' };

type Row = Record<string, unknown>;
const FALLBACK_ROLES: RoleRow[] = [
  { id: 'admin', name: 'Administrateur', description: 'Accès total', isSystem: true, perms: { calculateur: 'write', budget: 'write', analyse: 'write' } },
  { id: 'brasseur', name: 'Brasseur', description: 'Peut modifier les applications autorisées', isSystem: true, perms: { calculateur: 'write', budget: 'write', analyse: 'write' } },
  { id: 'user', name: 'Utilisateur', description: 'Consultation seule', isSystem: true, perms: { calculateur: 'read', budget: 'read', analyse: 'read' } },
];

export default async function AdminUsersPage() {
  // 1. Authentification et rôle : non connecté -> /login ; connecté sans le rôle admin -> /dashboard
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin/users');
  const { data: isAdmin } = await supabase.rpc('is_admin');
  if (!isAdmin) redirect('/dashboard');

  // 2. Données (clé de service si disponible : e-mails, statuts ; sinon RLS administrateur)
  const admin = createAdminClient();
  const db = admin ?? supabase;
  const warnings: string[] = [];
  const [prof, rolesQ, permsQ] = await Promise.all([
    db.from('profiles').select('*'),
    db.from('roles').select('*'),
    db.from('role_permissions').select('role_id,app_key,level'),
  ]);
  if (prof.error) warnings.push('Profils : ' + prof.error.message);

  let roles: RoleRow[] = FALLBACK_ROLES;
  let rolesReady = false;
  if (rolesQ.error || permsQ.error) {
    warnings.push('Rôles : tables absentes ou illisibles. Exécutez sql/05_roles_permissions.sql dans Supabase (SQL Editor) : les trois rôles d’origine sont affichés en attendant.');
  } else {
    rolesReady = true;
    const permMap = new Map<string, Partial<Record<AppKey, Level>>>();
    ((permsQ.data ?? []) as Row[]).forEach((p) => {
      const id = String(p.role_id);
      permMap.set(id, { ...(permMap.get(id) ?? {}), [String(p.app_key)]: String(p.level) as Level });
    });
    roles = ((rolesQ.data ?? []) as Row[]).map((r) => {
      const id = String(r.id);
      const perms = {} as Record<AppKey, Level>;
      APP_KEYS.forEach((k) => { perms[k] = id === 'admin' ? 'write' : (permMap.get(id)?.[k] ?? 'none'); });
      return { id, name: String(r.name ?? id), description: String(r.description ?? ''), isSystem: Boolean(r.is_system) || ['admin', 'brasseur', 'user'].includes(id), perms };
    }).sort((a, b) => (a.id === 'admin' ? -1 : b.id === 'admin' ? 1 : a.isSystem !== b.isSystem ? (a.isSystem ? -1 : 1) : a.name.localeCompare(b.name, 'fr')));
  }

  // 3. Comptes d'authentification : e-mail, statut (invitation en attente, suspendu), dernière connexion
  type AuthInfo = { email?: string; last: string | null; created: string | null; status: UserRow['status'] };
  const authInfo = new Map<string, AuthInfo>();
  if (admin) {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) warnings.push('Comptes : ' + error.message);
    const now = Date.now();
    ((data?.users ?? []) as any[]).forEach((u: any) => {
      const banned = (u as { banned_until?: string | null }).banned_until;
      const status: UserRow['status'] = banned && new Date(banned).getTime() > now ? 'suspended' : !u.email_confirmed_at && !u.last_sign_in_at ? 'pending' : 'active';
      authInfo.set(u.id, { email: u.email ?? undefined, last: u.last_sign_in_at ?? null, created: u.created_at ?? null, status });
    });
  }

  const profById = new Map(((prof.data ?? []) as Row[]).map((p) => [String(p.id), p]));
  const ids = new Set<string>([...profById.keys(), ...authInfo.keys()]);
  const users: UserRow[] = [...ids].map((id) => {
    const p = profById.get(id) ?? {};
    const a = authInfo.get(id);
    return {
      id,
      email: a?.email ?? (typeof p.email === 'string' ? p.email : ''),
      name: String(p.full_name ?? p.name ?? p.display_name ?? ''),
      role: typeof p.role === 'string' ? p.role : 'user',
      hasProfile: profById.has(id),
      last: a?.last ?? null,
      created: a?.created ?? null,
      status: a?.status ?? 'unknown',
    };
  }).sort((x, y) => (x.name || x.email).localeCompare(y.name || y.email, 'fr'));

  return (
    <>
      <AppHeader title="Administration" right={<span className="site-role">Admin</span>} />
      <UsersAdmin users={users} roles={roles} rolesReady={rolesReady} currentUserId={user.id} hasServiceKey={Boolean(admin)} warnings={warnings} />
    </>
  );
}
