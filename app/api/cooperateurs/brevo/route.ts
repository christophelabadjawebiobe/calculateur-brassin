// app/api/cooperateurs/brevo/route.ts : ajout ou mise à jour du contact dans la liste Brevo des coopérateurs
//   POST { demande_id }
import { brevoSync } from '@/lib/cooperateurs/connectors';
import { garde, json, messageErreur } from '@/lib/cooperateurs/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const g = await garde(true); if ('err' in g) return g.err;
  try {
    const b: any = await req.json().catch(() => ({}));
    const q = await g.supabase.from('cooperateur_demandes').select('id,nom,prenom,representant,email,telephone').eq('id', String(b.demande_id || '')).maybeSingle();
    if (q.error || !q.data) return json({ ok: false, message: 'Demande introuvable' }, 404);
    const r = await brevoSync(q.data as any);
    if (r.ok && !r.simulation) await g.supabase.from('cooperateur_demandes').update({ brevo_synced: true }).eq('id', (q.data as any).id);
    return json(r, r.ok ? 200 : 400);
  } catch (e: any) { return json({ ok: false, message: messageErreur(e) }, 502); }
}
