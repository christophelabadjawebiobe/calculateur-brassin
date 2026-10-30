// lib/supabase/admin.ts : client Supabase « service role » (SERVEUR UNIQUEMENT : actions serveur et composants serveur).
// La clé SUPABASE_SERVICE_ROLE_KEY contourne la RLS : ne jamais la préfixer par NEXT_PUBLIC_ ni l'importer dans un composant client.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const hasServiceKey = () => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

export function createAdminClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Client « anonyme » en flux implicite : pour resetPasswordForEmail depuis le serveur (le flux PKCE de @supabase/ssr
 *  lierait le lien reçu par l'utilisateur au navigateur de l'administrateur, et il échouerait). */
export function createImplicitClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { flowType: 'implicit', autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
