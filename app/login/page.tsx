'use client';
// app/login/page.tsx : connexion email / mot de passe (Supabase Auth via @supabase/ssr)
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(error.message === 'Invalid login credentials' ? 'Email ou mot de passe incorrect.' : error.message);
      setLoading(false);
      return;
    }
    // Redirection vers la page demandée initialement (chemin interne uniquement)
    const next = new URLSearchParams(window.location.search).get('next');
    router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">La Badjawe</h1>
          <p className="text-sm text-gray-600">Connectez-vous pour accéder à vos applications.</p>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Email</span>
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Mot de passe</span>
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
        </label>
        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full rounded-md bg-amber-600 px-3 py-2 font-medium text-white hover:bg-amber-700 disabled:opacity-60">
          {loading ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </main>
  );
}
