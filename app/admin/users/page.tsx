// app/admin/users/page.tsx : administration des utilisateurs (réservée au rôle « admin »)
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import AppHeader from '@/components/AppHeader';
import UsersAdmin, { type AppInfo, type UserRow } from './UsersAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin : utilisateurs' };

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin/users');
  const { data: isAdmin } = await supabase.rpc('is_admin');
  if (!isAdmin) redirect('/dashboard');

  const admin = createAdminClient();
  const db = admin ?? supabase;
  const warnings: string[] = [];
  const [prof, apps, perms] = await Promise.all([
    db.from('profiles').select('*'),
    db.from('applications').select('*'),
    db.from('user_app_permissions').select('user_id,app_id,has_access'),
  ]);
  if (prof.error) warnings.push('Profils : ' + prof.error.message);
  if (apps.error) warnings.push('Applications : ' + apps.error.message);
  if (perms.error) warnings.push('Droits : ' + perms.error.message);

  // e-mail, dernière connexion : uniquement via la clé service (table auth.users)
  const authInfo = new Map<string, { email?: string; last?: string | null; created?: string; confirmed?: boolean }>();
  if (admin) {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) warnings.push('Comptes : ' + error.message);
    (data?.users ?? []).forEach((u) => authInfo.set(u.id, { email: u.email ?? undefined, last: u.last_sign_in_at, created: u.created_at, confirmed: Boolean(u.email_confirmed_at) }));
  }

  const appList: AppInfo[] = ((apps.data ?? []) as Record<string, unknown>[])
    .map((a) => ({ id: String(a.id), name: String(a.name ?? a.title ?? a.label ?? a.route), route: String(a.route ?? '') }))
    .filter((a) => a.route !== '/admin/users')
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const granted = new Set(((perms.data ?? []) as { user_id: string; app_id: string; has_access: boolean }[]).filter((p) => p.has_access).map((p) => p.user_id + '|' + p.app_id));

  const ids = new Set<string>([...((prof.data ?? []) as { id: string }[]).map((p) => p.id), ...authInfo.keys()]);
  const profById = new Map(((prof.data ?? []) as Record<string, unknown>[]).map((p) => [String(p.id), p]));
  const users: UserRow[] = [...ids].map((id) => {
    const p = profById.get(id) ?? {};
    const a = authInfo.get(id);
    const email = a?.email ?? (typeof p.email === 'string' ? p.email : '');
    return {
      id, email,
      name: String(p.full_name ?? p.name ?? p.display_name ?? ''),
      role: typeof p.role === 'string' ? p.role : 'user',
      hasProfile: profById.has(id),
      last: a?.last ?? null, created: a?.created ?? null, confirmed: a?.confirmed ?? null,
      access: appList.filter((x) => granted.has(id + '|' + x.id)).map((x) => x.id),
    };
  }).sort((x, y) => (x.name || x.email).localeCompare(y.name || y.email, 'fr'));

  return (
    <>
      <AppHeader title="Administration" right={<span className="site-role">Admin</span>} />
      <UsersAdmin users={users} apps={appList} currentUserId={user.id} hasServiceKey={Boolean(admin)} warnings={warnings} />
    </>
  );
}
