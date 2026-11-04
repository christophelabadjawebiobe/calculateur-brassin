'use client';
// app/admin/users/error.tsx : filet de sécurité : une erreur de chargement n'affiche plus une page blanche
export default function UsersError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ maxWidth: 640, margin: '48px auto', padding: 16 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Impossible d’afficher les utilisateurs</h1>
      <p style={{ color: 'var(--muted)' }}>{error.message || 'Erreur inattendue.'} Vérifiez que sql/04_admin_reel_validation.sql a été exécuté dans Supabase et que les variables d’environnement sont définies.</p>
      <button type="button" className="site-btn" style={{ color: 'var(--ink)', borderColor: 'var(--line)' }} onClick={reset}>Réessayer</button>
    </main>
  );
}
