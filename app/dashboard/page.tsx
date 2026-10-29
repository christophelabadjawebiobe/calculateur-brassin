// app/dashboard/page.tsx : tableau de bord « style Odoo » : une tuile par application autorisée
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AppHeader from '@/components/AppHeader';
import AppIcon, { type IconName } from '@/components/AppIcon';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tableau de bord' };

type AppRow = { id: string | number; route: string; name?: string; title?: string; label?: string; description?: string | null; icon?: string | null };
type Tile = { id: string | number; href: string; name: string; icon: IconName; description: string };

async function signOut() {
  'use server';
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

/** Nom, icône et description d'une tuile selon la route (les noms de la base n'ont plus d'importance) */
function tileFor(a: AppRow): Tile {
  const r = a.route || '';
  const desc = (d: string) => (a.description && a.description.trim() ? a.description : d);
  if (r.includes('analyse')) return { id: a.id, href: r, name: 'Reporting', icon: 'chart-bar', description: desc('Réalisé, budget validé et année précédente') };
  if (r.includes('budget')) return { id: a.id, href: r, name: 'Budget', icon: 'wallet', description: desc('Budget prévisionnel par compte') };
  if (r.includes('calcul')) return { id: a.id, href: r, name: 'Recette', icon: 'calculator', description: desc('Recettes et calculs de brassin') };
  if (r.includes('users') || r.includes('admin')) return { id: a.id, href: '/admin/users', name: 'Admin', icon: 'users', description: desc('Utilisateurs, rôles et accès') };
  return { id: a.id, href: r, name: a.name ?? a.title ?? a.label ?? r, icon: 'grid', description: a.description ?? '' };
}
const isAdminTile = (a: AppRow) => /users|admin/.test(a.route || '');

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: apps }, { data: admin }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('applications').select('*'),
    supabase.rpc('is_admin'),
  ]);
  const isAdmin = Boolean(admin);

  // Permissions : admin = tout ; sinon on interroge has_app_access() pour chaque application (même règle que la RLS).
  // La tuile « Admin » n'est jamais montrée aux non-administrateurs.
  const all = ((apps ?? []) as AppRow[]).filter((a) => isAdmin || !isAdminTile(a));
  const checks = await Promise.all(all.map(async (a) => (isAdmin ? true : Boolean((await supabase.rpc('has_app_access', { p_route: a.route })).data))));
  const tiles = all.filter((_, i) => checks[i]).map(tileFor);
  if (isAdmin && !tiles.some((t) => t.href === '/admin/users')) tiles.push(tileFor({ id: 'admin-users', route: '/admin/users' }));
  tiles.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  const who = (profile as { full_name?: string; name?: string } | null)?.full_name ?? (profile as { name?: string } | null)?.name ?? user.email;

  return (
    <div>
      <AppHeader
        title="Gestion de la brasserie"
        home={false}
        right={
          <>
            <span className="site-who">{who}</span>
            <form action={signOut}><button className="site-btn">Déconnexion</button></form>
          </>
        }
      />
      <main className="dash-main">
        <h1>Tableau de bord</h1>
        <p className="dash-lead">Vos applications.</p>

        {tiles.length === 0 ? (
          <p className="dash-empty">Aucune application n’est activée pour votre compte. Demandez l’accès à un administrateur.</p>
        ) : (
          <ul className="dash-grid">
            {tiles.map((t) => (
              <li key={t.id}>
                <Link href={t.href} className="dash-tile">
                  <span aria-hidden className="dash-ico"><AppIcon name={t.icon} size={28} /></span>
                  <span className="dash-name">{t.name}</span>
                  {t.description && <span className="dash-desc">{t.description}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
