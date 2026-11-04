// app/api/cooperateurs/diagnostic/route.ts : « Tester les connecteurs » (administrateurs uniquement)
//   GET : vérifie pas à pas Google Sheet, Odoo et Brevo (authentification, identifiants des modèles / listes, colonnes reconnues).
//   Ne renvoie jamais les clés d'API ni la clé privée ; ne crée ni ne modifie rien chez les prestataires.
import { diagnosticBrevo, diagnosticGoogle, diagnosticOdoo } from '@/lib/cooperateurs/connectors';
import { garde, json, messageErreur } from '@/lib/cooperateurs/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const g = await garde(false); if ('err' in g) return g.err;
  const adm = await g.supabase.rpc('is_admin');
  if (adm.error || !adm.data) return json({ ok: false, message: 'Réservé aux administrateurs' }, 403);
  try {
    const [google, odoo, brevo] = await Promise.all([diagnosticGoogle(), diagnosticOdoo(), diagnosticBrevo()]);
    return json({ ok: true, services: [google, odoo, brevo] });
  } catch (e: any) { return json({ ok: false, message: messageErreur(e) }, 502); }
}
