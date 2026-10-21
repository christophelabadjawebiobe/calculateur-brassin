// app/dashboard/page.tsx : tableau de bord « style Odoo » : une tuile par application autorisée
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AppHeader from '@/components/AppHeader';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tableau de bord' };

type AppRow = { id: string | number; route: string; name?: string; title?: string; label?: string; description?: string | null; icon?: string | null };

async function signOut() {
  'use server';
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: apps }, { data: admin }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('applications').select('*'),
    supabase.rpc('is_admin'),
  ]);

  // Permissions : admin = tout ; sinon on interroge has_app_access() pour chaque application (même règle que la RLS)
  const all = (apps ?? []) as AppRow[];
  const checks = await Promise.all(
    all.map(async (a) => (admin ? true : Boolean((await supabase.rpc('has_app_access', { p_route: a.route })).data))),
  );
  const allowed = all.filter((_, i) => checks[i]).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'fr'));

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

        {allowed.length === 0 ? (
          <p className="dash-empty">Aucune application n’est activée pour votre compte. Demandez l’accès à un administrateur.</p>
        ) : (
          <ul className="dash-grid">
            {allowed.map((a) => (
              <li key={a.id}>
                <Link href={a.route} className="dash-tile">
                  <span aria-hidden className="dash-ico">{a.icon || iconOf(a.route)}</span>
                  <span className="dash-name">{nameOf(a)}</span>
                  {a.description && <span className="dash-desc">{a.description}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

const nameOf = (a: AppRow) => a.name ?? a.title ?? a.label ?? a.route;

// icône par défaut selon la route, quand la table applications n'en fournit pas
const iconOf = (route: string) => (route.includes('calcul') ? '🧮' : route.includes('budget') ? '📒' : route.includes('analyse') ? '📊' : '▦');
