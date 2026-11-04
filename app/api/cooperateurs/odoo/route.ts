// app/api/cooperateurs/odoo/route.ts : connecteur Odoo (JSON-RPC) : Odoo Sign et liste de diffusion « Coopérateurs »
//   POST { action: 'sign_send' | 'sign_remind' | 'sign_status' | 'sign_status_all' | 'mailing_sync', demande_id? }
import { odooMailingSync, odooSignRemind, odooSignSend, odooSignStatus, isSim, config } from '@/lib/cooperateurs/connectors';
import { garde, json, messageErreur } from '@/lib/cooperateurs/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const g = await garde(true); if ('err' in g) return g.err;
  const { supabase } = g;
  try {
    const b: any = await req.json().catch(() => ({}));
    const action = String(b.action || '');
    if (action === 'sign_status_all') {
      const l = await supabase.from('cooperateur_demandes').select('id,odoo_sign_request_id').eq('odoo_sign_status', 'envoye').eq('is_locked', false);
      let maj = 0, signes = 0;
      for (const d of (l.data || []) as { id: string; odoo_sign_request_id: string | null }[]) {
        if (!d.odoo_sign_request_id || isSim(d.odoo_sign_request_id)) continue;
        const s = await odooSignStatus(d.odoo_sign_request_id);
        if (s.ok && s.statut === 'signe') { await supabase.from('cooperateur_demandes').update({ odoo_sign_status: 'signe' }).eq('id', d.id); maj++; signes++; }
      }
      return json({ ok: true, simulation: !config().odoo, message: config().odoo ? `${signes} signature${signes > 1 ? 's' : ''} confirmée${signes > 1 ? 's' : ''} par Odoo Sign` : 'Simulation : Odoo non configuré, statuts inchangés', maj });
    }
    const id = String(b.demande_id || '');
    const q = await supabase.from('cooperateur_demandes').select('*').eq('id', id).maybeSingle();
    if (q.error || !q.data) return json({ ok: false, message: 'Demande introuvable' }, 404);
    const d: any = q.data;
    if (action === 'sign_send') {
      if (d.is_locked) return json({ ok: false, message: 'Demande verrouillée' }, 409);
      if (d.odoo_sign_status === 'signe') return json({ ok: false, message: 'Le bulletin est déjà signé' }, 409);
      if (d.odoo_sign_status === 'envoye' && d.odoo_sign_request_id && !(isSim(d.odoo_sign_request_id) && config().odoo)) return json({ ok: false, message: 'Bulletin déjà envoyé : utilisez « Relancer »' }, 409);
      const r = await odooSignSend(d);
      if (!r.ok) return json(r, 400);
      const u = await supabase.from('cooperateur_demandes').update({ odoo_sign_request_id: r.requestId, odoo_sign_status: 'envoye', date_dernier_rappel: null }).eq('id', id);
      if (u.error) return json({ ok: false, message: u.error.message }, 400);
      return json(r);
    }
    if (action === 'sign_remind') {
      if (d.odoo_sign_status !== 'envoye' || !d.odoo_sign_request_id) return json({ ok: false, message: 'Aucun bulletin en attente de signature' }, 409);
      const r = await odooSignRemind(d.odoo_sign_request_id);
      if (r.ok) await supabase.from('cooperateur_demandes').update({ date_dernier_rappel: new Date().toISOString() }).eq('id', id);
      return json(r, r.ok ? 200 : 400);
    }
    if (action === 'sign_status') {
      if (!d.odoo_sign_request_id) return json({ ok: false, message: 'Aucune demande de signature' }, 409);
      const s = await odooSignStatus(d.odoo_sign_request_id);
      if (s.ok && s.statut === 'signe') await supabase.from('cooperateur_demandes').update({ odoo_sign_status: 'signe' }).eq('id', id);
      return json(s, s.ok ? 200 : 400);
    }
    if (action === 'mailing_sync') {
      const r = await odooMailingSync(d);
      if (r.ok && !r.simulation) await supabase.from('cooperateur_demandes').update({ odoo_mailing_synced: true }).eq('id', id);
      return json(r, r.ok ? 200 : 400);
    }
    return json({ ok: false, message: 'Action inconnue' }, 400);
  } catch (e: any) { return json({ ok: false, message: messageErreur(e) }, 502); }
}
