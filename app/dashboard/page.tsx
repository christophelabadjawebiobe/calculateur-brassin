// app/dashboard/page.tsx : tableau de bord « style Odoo » : une tuile par application autorisée
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

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
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <span className="font-semibold">La Badjawe</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-600">{who}</span>
          <form action={signOut}>
            <button className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-100">Déconnexion</button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4">
        <h1 className="mb-1 text-2xl font-semibold">Tableau de bord</h1>
        <p className="mb-6 text-sm text-gray-600">Vos applications.</p>

        {allowed.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-gray-600">
            Aucune application n’est activée pour votre compte. Demandez l’accès à un administrateur.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {allowed.map((a) => (
              <li key={a.id}>
                <Link href={a.route}
                  className="flex h-full flex-col items-center gap-2 rounded-xl border border-gray-200 bg-white p-5 text-center shadow-sm transition hover:border-amber-500 hover:shadow-md">
                  <span aria-hidden className="text-4xl">{a.icon || '▦'}</span>
                  <span className="font-medium">{nameOf(a)}</span>
                  {a.description && <span className="text-xs text-gray-500">{a.description}</span>}
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
