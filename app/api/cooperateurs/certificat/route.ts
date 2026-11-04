// app/api/cooperateurs/certificat/route.ts : certificat officiel de parts sociales en PDF (A4 paysage, maquette de Sam)
//   GET  ?cooperateur=ID[,ID…] | ?demande=UUID  &date=AAAA-MM-JJ  &civilite=M.|Mme  &download=1   → application/pdf
//   POST { cooperateur_id, demande_id?, civilite?, date? } → envoie le certificat par e-mail (Brevo ; simulation sans clé)
import { buildCertificatPdf, CERT_ACCOUNT_DEFAUT, type CertInput } from '@/lib/cooperateurs/certificat';
import { brevoEnvoyerCertificat } from '@/lib/cooperateurs/connectors';
import { garde, json, messageErreur } from '@/lib/cooperateurs/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function charge(supabase: any, ids: number[], civilite: string, date: string): Promise<{ list: CertInput[]; emails: (string | null)[] }> {
  const par = await supabase.from('parametres').select('cle,valeur').in('cle', ['valeur_part', 'compte_bancaire']);
  const P: Record<string, string> = {}; (par.data || []).forEach((r: any) => { P[r.cle] = r.valeur; });
  const q = await supabase.from('cooperateurs').select('*, categories(code), adresses(*), contacts(*), mouvements_parts(date_mouvement,nombre_parts)').in('id', ids);
  if (q.error) throw new Error(q.error.message);
  const byId = new Map<number, any>((q.data || []).map((c: any) => [c.id, c]));
  const list: CertInput[] = [], emails: (string | null)[] = [];
  for (const id of ids) {
    const c = byId.get(id); if (!c) continue;
    const adr = (c.adresses || []).slice().sort((a: any, b: any) => Number(b.type === 'principale') - Number(a.type === 'principale') || a.id - b.id)[0] || null;
    const mail = (c.contacts || []).filter((x: any) => x.type === 'email').sort((a: any, b: any) => Number(b.principal) - Number(a.principal) || a.id - b.id)[0];
    list.push({
      numero: c.certificat ?? '—', provisoire: c.certificat == null, classe: c.categories ? c.categories.code : null, nom: c.nom, prenom: c.prenom, representant: c.representant,
      civilite: civilite === 'M.' || civilite === 'Mme' ? civilite : '', adresse: adr, valeurPart: Number(P.valeur_part || 250), compte: P.compte_bancaire || CERT_ACCOUNT_DEFAUT, dateEmission: date,
      mouvements: (c.mouvements_parts || []).map((m: any) => ({ date: m.date_mouvement, parts: m.nombre_parts })),
    });
    emails.push(mail ? mail.valeur : null);
  }
  return { list, emails };
}
const aujourdhui = (): string => new Date().toISOString().slice(0, 10);

export async function GET(req: Request) {
  const g = await garde(false); if ('err' in g) return g.err;
  try {
    const u = new URL(req.url); const date = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('date') || '') ? u.searchParams.get('date')! : aujourdhui();
    let ids = (u.searchParams.get('cooperateur') || '').split(',').map((x: string) => parseInt(x, 10)).filter((n: number) => n > 0).slice(0, 200);
    const dem = u.searchParams.get('demande');
    if (dem) {
      const d = await g.supabase.from('cooperateur_demandes').select('cooperateur_id').eq('id', dem).maybeSingle();
      if (!d.data || !d.data.cooperateur_id) return json({ ok: false, message: 'Cette demande n’est pas encore validée dans le registre' }, 409);
      ids = [d.data.cooperateur_id];
    }
    if (!ids.length) return json({ ok: false, message: 'Coopérateur manquant' }, 400);
    const { list } = await charge(g.supabase, ids, u.searchParams.get('civilite') || '', date);
    if (!list.length) return json({ ok: false, message: 'Coopérateur introuvable' }, 404);
    const pdf = await buildCertificatPdf(list);
    if (dem) await g.supabase.from('cooperateur_demandes').update({ certificat_genere: true }).eq('id', dem);   // autorisé même sur une ligne verrouillée
    const nom = list.length === 1 ? `certificat-${list[0].numero}-${String(list[0].nom).normalize('NFD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}` : `certificats-${list.length}`;
    return new Response(Buffer.from(pdf), { headers: { 'content-type': 'application/pdf', 'content-disposition': `${u.searchParams.get('download') ? 'attachment' : 'inline'}; filename="${nom}.pdf"`, 'cache-control': 'no-store' } });
  } catch (e: any) { return json({ ok: false, message: messageErreur(e) }, 502); }
}

export async function POST(req: Request) {
  const g = await garde(true); if ('err' in g) return g.err;
  try {
    const b: any = await req.json().catch(() => ({}));
    let cid = Number(b.cooperateur_id || 0);
    if (!cid && b.demande_id) { const d = await g.supabase.from('cooperateur_demandes').select('cooperateur_id').eq('id', b.demande_id).maybeSingle(); cid = d.data ? d.data.cooperateur_id : 0; }
    if (!cid) return json({ ok: false, message: 'Coopérateur manquant (demande non validée ?)' }, 409);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : aujourdhui();
    const { list, emails } = await charge(g.supabase, [cid], b.civilite || '', date);
    if (!list.length) return json({ ok: false, message: 'Coopérateur introuvable' }, 404);
    if (!emails[0]) return json({ ok: false, message: 'Ce coopérateur n’a pas d’adresse e-mail' }, 409);
    const pdf = await buildCertificatPdf(list);
    const c = list[0]; const nom = [c.prenom, c.nom].filter(Boolean).join(' ');
    const r = await brevoEnvoyerCertificat({ email: emails[0]!, nom }, pdf, `certificat-${c.numero}.pdf`);
    if (r.ok && !r.simulation && b.demande_id) await g.supabase.from('cooperateur_demandes').update({ certificat_genere: true }).eq('id', b.demande_id);
    return json(r, r.ok ? 200 : 400);
  } catch (e: any) { return json({ ok: false, message: messageErreur(e) }, 502); }
}
