// app/api/cooperateurs/valider/route.ts : « Valider dans le registre »
//   POST { demande_id, date?: 'AAAA-MM-JJ', resync?: boolean }
//   1. valider_demande() (SQL, atomique) : fiche + adresse + contacts + mouvement de parts, n° de certificat MAX+1, ligne verrouillée
//   2. synchronisation Odoo (mailing.contact) et Brevo ; un échec n'annule PAS la validation : les drapeaux restent à faux et
//      « resync: true » permet de réessayer plus tard.
//   Newsletter : Odoo (liste de diffusion) et Brevo ne reçoivent le contact que si consentement_newsletter = true (« Oui » explicite au formulaire).
import { brevoSync, odooMailingSync } from '@/lib/cooperateurs/connectors';
import { consentementNewsletter, garde, json, messageErreur } from '@/lib/cooperateurs/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const g = await garde(true); if ('err' in g) return g.err;
  const { supabase } = g;
  try {
    const b: any = await req.json().catch(() => ({}));
    const id = String(b.demande_id || '');
    let res: any = null;
    if (!b.resync) {
      const v = await supabase.rpc('valider_demande', { p_demande: id, p_date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null });
      if (v.error) return json({ ok: false, message: v.error.message }, 400);
      res = v.data;
    }
    const q = await supabase.from('cooperateur_demandes').select('*').eq('id', id).maybeSingle();
    if (q.error || !q.data) return json({ ok: false, message: 'Demande introuvable' }, 404);
    const d: any = q.data;
    if (!d.valide_registre) return json({ ok: false, message: 'Demande non validée dans le registre' }, 409);
    d.consentement_newsletter = await consentementNewsletter(supabase, d);      // consentement de la fiche (réponse la plus récente)
    const warnings: string[] = []; const flags: Record<string, boolean> = {}; let simulation = false;
    for (const [nom, f, flag] of [['Odoo', odooMailingSync, 'odoo_mailing_synced'], ['Brevo', brevoSync, 'brevo_synced']] as const) {
      if (d[flag]) continue;
      if (!d.consentement_newsletter) continue;      // RGPD : jamais d'envoi vers Odoo / Brevo sans consentement « Oui » à la newsletter
      try {
        const r = await f(d);
        if (r.simulation) { simulation = true; warnings.push(r.message); }
        else if (r.ok) flags[flag] = true; else warnings.push(`${nom} : ${r.message}`);
      } catch (e: any) { warnings.push(`${nom} : ${messageErreur(e)}`); }
    }
    if (Object.keys(flags).length) await supabase.from('cooperateur_demandes').update(flags).eq('id', id);
    return json({ ok: true, simulation, resultat: res, odoo_mailing_synced: Boolean(d.odoo_mailing_synced || flags.odoo_mailing_synced), brevo_synced: Boolean(d.brevo_synced || flags.brevo_synced), newsletter: Boolean(d.consentement_newsletter), warnings,
      message: res ? (res.nouveau ? `Coopérateur inscrit au registre : certificat n° ${res.certificat}` : `Rachat de parts ajouté à la fiche existante (certificat n° ${res.certificat ?? '—'})`) : 'Synchronisation relancée' });
  } catch (e: any) { return json({ ok: false, message: messageErreur(e) }, 502); }
}
