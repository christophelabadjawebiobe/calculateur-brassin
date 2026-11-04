// app/api/cooperateurs/google-sheet/route.ts : synchronisation des souscriptions (Google Sheet ou CSV) vers cooperateur_demandes
//   GET  : état des connecteurs (réel / simulation)
//   POST : { csv?: string, simulation_import?: boolean } : lit le Sheet (ou le CSV fourni), nettoie (modulo 97, référence « LDF2026 : NOM Prénom »)
//          et appelle importer_demandes() (déduplication par google_row_id : une ligne déjà importée n'est jamais écrasée)
import { cleanRows, SIM_TABLE, parseCsv } from '@/lib/cooperateurs/sheet';
import { config, lireGoogleSheet } from '@/lib/cooperateurs/connectors';
import { garde, json, messageErreur } from '@/lib/cooperateurs/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const g = await garde(false); if ('err' in g) return g.err;
  const c = config();
  return json({ ok: true, google: c.google, odoo: c.odoo, brevo: c.brevo });
}

export async function POST(req: Request) {
  const g = await garde(true); if ('err' in g) return g.err;
  try {
    const body: any = await req.json().catch(() => ({}));
    const p = await g.supabase.from('parametres').select('valeur').eq('cle', 'prefixe_reference').maybeSingle();
    const prefixe = (p.data && p.data.valeur) || 'LDF';
    let source: 'csv' | 'google_sheet' | 'simulation'; let table: string[][];
    if (typeof body.csv === 'string' && body.csv.trim()) { source = 'csv'; table = parseCsv(body.csv); }
    else if (config().google) { source = 'google_sheet'; table = await lireGoogleSheet(); }
    else { source = 'simulation'; table = SIM_TABLE; }
    const { rows, ignorees } = cleanRows(table, { prefixe });
    if (source === 'simulation') {
      const demo = rows.map((r) => ({ ...r, google_row_id: 'SIM-' + r.google_row_id, donnees_brutes: { ...r.donnees_brutes, simulation: true } }));
      if (!body.simulation_import) {
        return json({ ok: true, simulation: true, source, lues: rows.length, importees: 0, ignorees, apercu: demo.map((r) => ({ nom: r.nom, prenom: r.prenom, parts: r.nombre_parts, reference: r.reference_bancaire })),
          message: 'Mode simulation : GOOGLE_SHEET_ID n’est pas renseigné, rien n’a été importé. Importez un CSV, ou importez les 3 lignes de démonstration.' });
      }
      const r = await g.supabase.rpc('importer_demandes', { p_rows: demo });
      if (r.error) return json({ ok: false, message: r.error.message }, 400);
      return json({ ok: true, simulation: true, source, lues: demo.length, ...(r.data as object), message: 'Mode simulation : lignes de démonstration importées (préfixe SIM-, supprimables tant qu’elles ne sont pas validées).' });
    }
    if (!rows.length) return json({ ok: true, source, lues: 0, importees: 0, ignorees, message: 'Aucune ligne exploitable dans ' + (source === 'csv' ? 'le CSV' : 'le Google Sheet') + ' (en-têtes reconnus : nom, prénom, e-mail, parts…)' });
    const r = await g.supabase.rpc('importer_demandes', { p_rows: rows });
    if (r.error) return json({ ok: false, message: r.error.message }, 400);
    const res = r.data as { importees: number; ignorees: number };
    return json({ ok: true, source, lues: rows.length, importees: res.importees, ignorees: res.ignorees + ignorees,
      message: `${res.importees} nouvelle${res.importees > 1 ? 's' : ''} demande${res.importees > 1 ? 's' : ''} importée${res.importees > 1 ? 's' : ''}, ${res.ignorees + ignorees} déjà présente${res.ignorees + ignorees > 1 ? 's' : ''} ou vide${res.ignorees + ignorees > 1 ? 's' : ''}` });
  } catch (e: any) { return json({ ok: false, message: messageErreur(e) }, 502); }
}
