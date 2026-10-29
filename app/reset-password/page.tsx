'use client';
// app/reset-password/page.tsx : page publique « Nouveau mot de passe » (cible des e-mails et liens de réinitialisation).
// Prévoir dans Supabase > Authentication > URL Configuration : https://VOTRE-DOMAINE/reset-password dans « Redirect URLs ».
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type Phase = 'checking' | 'ready' | 'invalid' | 'done';

export default function ResetPasswordPage() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      try {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const query = new URLSearchParams(window.location.search);
        if (hash.get('error_description') || query.get('error_description')) { if (alive) { setErr((hash.get('error_description') || query.get('error_description') || '').replace(/\+/g, ' ')); setPhase('invalid'); } return; }
        const at = hash.get('access_token'), rt = hash.get('refresh_token');
        const code = query.get('code'), th = query.get('token_hash');
        if (at && rt) { const { error } = await supabase.auth.setSession({ access_token: at, refresh_token: rt }); if (error) throw error; }
        else if (code) { const { error } = await supabase.auth.exchangeCodeForSession(code); if (error) throw error; }
        else if (th) { const { error } = await supabase.auth.verifyOtp({ token_hash: th, type: 'recovery' }); if (error) throw error; }
        window.history.replaceState(null, '', window.location.pathname); // retire les jetons de l'adresse
        const { data } = await supabase.auth.getUser();
        if (alive) setPhase(data && data.user ? 'ready' : 'invalid');
      } catch (e) {
        if (alive) { setErr(e instanceof Error ? e.message : ''); setPhase('invalid'); }
      }
    })();
    return () => { alive = false; };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (pw.length < 8) { setErr('Le mot de passe doit contenir au moins 8 caractères.'); return; }
    if (pw !== pw2) { setErr('Les deux mots de passe ne sont pas identiques.'); return; }
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setErr(/same|different/i.test(error.message) ? 'Choisissez un mot de passe différent de l’ancien.' : error.message); return; }
    setPhase('done');
  }

  return (
    <main className="login-wrap">
      <form className="login-card" onSubmit={onSubmit} autoComplete="on">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="login-logo" src="/badjawe-logo.png" alt="La Badjawe : brasserie coopérative, éleveurs de bières bio" />
        <span className="login-kicker">BADJAWE - BRASSERIE COOPÉRATIVE</span>
        <h1>Nouveau mot de passe</h1>
        {phase === 'checking' ? <span className="login-sub">Vérification du lien…</span> : null}
        {phase === 'invalid' ? (
          <>
            <div className="login-err" role="alert">Ce lien n’est plus valable (il expire après une heure et ne sert qu’une fois).{err ? ' ' + err : ''}</div>
            <div className="login-note">Demandez un nouveau lien à l’administrateur de la brasserie.</div>
            <Link className="login-btn" style={{ textAlign: 'center', textDecoration: 'none' }} href="/login">Retour à la connexion</Link>
          </>
        ) : null}
        {phase === 'ready' ? (
          <>
            <span className="login-sub">Choisissez un mot de passe d’au moins 8 caractères.</span>
            <label htmlFor="rp1">Nouveau mot de passe</label>
            <input id="rp1" type="password" required minLength={8} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <label htmlFor="rp2">Confirmer le mot de passe</label>
            <input id="rp2" type="password" required minLength={8} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            <button className="login-btn" type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le mot de passe'}</button>
            <div className="login-err" role="alert" aria-live="polite">{err}</div>
          </>
        ) : null}
        {phase === 'done' ? (
          <>
            <span className="login-sub" role="status">Mot de passe mis à jour.</span>
            <Link className="login-btn" style={{ textAlign: 'center', textDecoration: 'none' }} href="/dashboard">Ouvrir le tableau de bord</Link>
          </>
        ) : null}
      </form>
    </main>
  );
}
