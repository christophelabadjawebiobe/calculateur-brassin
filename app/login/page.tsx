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
    // Retour vers la page demandée initialement (chemin interne uniquement)
    const next = new URLSearchParams(window.location.search).get('next');
    router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
    router.refresh();
  }

  return (
    <main className="login-wrap">
      <form className="login-card" onSubmit={onSubmit} autoComplete="on">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="login-logo" src="/badjawe-logo.png" alt="La Badjawe : brasserie coopérative, éleveurs de bières bio" />
        <span className="login-kicker">BADJAWE - BRASSERIE COOPÉRATIVE</span>
        <h1>Gestion de la brasserie</h1>
        <span className="login-sub">Éleveurs de bières bio · accès réservé</span>

        <label htmlFor="login-email">Email</label>
        <input id="login-email" type="email" required autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />

        <label htmlFor="login-pass">Mot de passe</label>
        <input id="login-pass" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />

        <button className="login-btn" type="submit" disabled={loading}>{loading ? 'Connexion…' : 'Se connecter'}</button>
        <div className="login-err" role="alert" aria-live="polite">{error}</div>
        <div className="login-note">Les comptes sont créés par l’administrateur de la brasserie.</div>
      </form>
    </main>
  );
}
