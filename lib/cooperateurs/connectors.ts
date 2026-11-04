// lib/cooperateurs/connectors.ts : connecteurs externes du module Coopérateurs (SERVEUR UNIQUEMENT : clés d'API dans process.env)
//   Google Sheet : GOOGLE_SHEET_ID (+ GOOGLE_API_KEY, GOOGLE_SHEET_NAME / GOOGLE_SHEET_GID facultatifs ; sans clé, le Sheet doit être partagé « toute personne disposant du lien »)
//   Odoo         : ODOO_URL, ODOO_API_KEY (+ ODOO_DB, ODOO_USER, ODOO_SIGN_TEMPLATE_ID, ODOO_SIGN_ROLE_ID, ODOO_MAILING_LIST_NAME)
//   Brevo        : BREVO_API_KEY (+ BREVO_LIST_ID, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME)
// Chaque connecteur a un MODE SIMULATION (variables absentes) : aucune requête externe, résultat factice mais cohérent (identifiants « SIM-… »).
import { parseCsv } from './sheet';
import type { ConnectorResult } from './types';

export const config = () => ({
  google: Boolean(process.env.GOOGLE_SHEET_ID),
  odoo: Boolean(process.env.ODOO_URL && process.env.ODOO_API_KEY),
  brevo: Boolean(process.env.BREVO_API_KEY),
});

const simId = (): string => 'SIM-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
export const isSim = (id: string | null | undefined): boolean => Boolean(id && id.startsWith('SIM-'));

async function http(url: string, init: RequestInit = {}, ms = 20000): Promise<Response> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal, cache: 'no-store' }); }
  catch (e: any) { throw new Error(e && e.name === 'AbortError' ? 'Délai dépassé' : 'Connexion impossible : ' + (e && e.message ? e.message : e)); }
  finally { clearTimeout(t); }
}

/* ===================== Google Sheet ===================== */
export async function lireGoogleSheet(): Promise<string[][]> {
  const id = process.env.GOOGLE_SHEET_ID!, key = process.env.GOOGLE_API_KEY, nom = process.env.GOOGLE_SHEET_NAME, gid = process.env.GOOGLE_SHEET_GID || '0';
  if (key) {
    const range = encodeURIComponent(nom ? `'${nom.replace(/'/g, "''")}'!A:ZZ` : 'A:ZZ');
    const r = await http(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${range}?key=${encodeURIComponent(key)}&valueRenderOption=FORMATTED_VALUE`);
    if (!r.ok) throw new Error(`Google Sheets API : HTTP ${r.status} (clé, identifiant ou partage du Sheet ?)`);
    const j: any = await r.json(); return (j.values || []) as string[][];
  }
  const r = await http(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/export?format=csv&gid=${encodeURIComponent(gid)}`);
  if (!r.ok) throw new Error(`Export du Sheet impossible (HTTP ${r.status}) : partagez-le « toute personne disposant du lien » ou renseignez GOOGLE_API_KEY`);
  const txt = await r.text();
  if (/^\s*<!doctype html|<html/i.test(txt.slice(0, 200))) throw new Error('Le Sheet n’est pas public : partagez-le « toute personne disposant du lien » (lecteur) ou renseignez GOOGLE_API_KEY');
  return parseCsv(txt);
}

/* ===================== Odoo (JSON-RPC) ===================== */
type Dem = { id?: string; nom: string; prenom?: string | null; email?: string | null; telephone?: string | null; representant?: string | null; reference_bancaire?: string | null; odoo_sign_request_id?: string | null };
const fullName = (d: Dem): string => [d.prenom, d.nom].filter(Boolean).join(' ') + (d.representant && !d.prenom ? ` (${d.representant})` : '');

class Odoo {
  url = (process.env.ODOO_URL || '').replace(/\/+$/, '');
  key = process.env.ODOO_API_KEY || '';
  user = process.env.ODOO_USER || '';
  db = process.env.ODOO_DB || '';
  uid = 0;
  private async rpc(service: string, method: string, args: any[]): Promise<any> {
    const r = await http(this.url + '/jsonrpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() }) });
    if (!r.ok) throw new Error(`Odoo : HTTP ${r.status}`);
    const j: any = await r.json();
    if (j.error) throw new Error('Odoo : ' + ((j.error.data && j.error.data.message) || j.error.message || 'erreur'));
    return j.result;
  }
  async login(): Promise<void> {
    if (!this.db) { try { const l = await this.rpc('db', 'list', []); if (Array.isArray(l) && l.length === 1) this.db = l[0]; } catch { /* liste des bases désactivée */ } }
    if (!this.db) this.db = new URL(this.url).hostname.split('.')[0];
    const uid = await this.rpc('common', 'authenticate', [this.db, this.user, this.key, {}]);
    if (!uid) throw new Error('Odoo : authentification refusée (ODOO_DB, ODOO_USER et ODOO_API_KEY ?)');
    this.uid = uid;
  }
  async call(model: string, method: string, args: any[] = [], kwargs: Record<string, any> = {}): Promise<any> {
    if (!this.uid) await this.login();
    return this.rpc('object', 'execute_kw', [this.db, this.uid, this.key, model, method, args, kwargs]);
  }
  async partner(d: Dem): Promise<number> {
    const em = String(d.email || '').trim();
    const f = await this.call('res.partner', 'search', [[['email', '=ilike', em]]], { limit: 1 });
    if (f.length) return f[0];
    return this.call('res.partner', 'create', [{ name: fullName(d), email: em, phone: d.telephone || false }]);
  }
}

/** Odoo Sign : demande de signature du bulletin de souscription (modèle ODOO_SIGN_TEMPLATE_ID) */
export async function odooSignSend(d: Dem): Promise<ConnectorResult> {
  if (!d.email) return { ok: false, message: 'Pas d’adresse e-mail : impossible d’envoyer le bulletin' };
  if (!config().odoo) return { ok: true, simulation: true, requestId: simId(), message: 'Simulation : demande de signature non envoyée (ODOO_URL / ODOO_API_KEY absents)' };
  const o = new Odoo(); const partner = await o.partner(d);
  let tpl = Number(process.env.ODOO_SIGN_TEMPLATE_ID || 0);
  if (!tpl) { const f = await o.call('sign.template', 'search', [[['name', 'ilike', 'souscription']]], { limit: 1 }); tpl = f[0]; }
  if (!tpl) throw new Error('Odoo Sign : modèle introuvable (renseignez ODOO_SIGN_TEMPLATE_ID)');
  let role = Number(process.env.ODOO_SIGN_ROLE_ID || 0);
  if (!role) {
    const t = await o.call('sign.template', 'read', [[tpl], ['sign_item_ids']]);
    const it = t[0] && t[0].sign_item_ids && t[0].sign_item_ids.length ? await o.call('sign.item', 'read', [t[0].sign_item_ids.slice(0, 1), ['responsible_id']]) : [];
    role = it[0] && it[0].responsible_id ? it[0].responsible_id[0] : 0;
  }
  if (!role) throw new Error('Odoo Sign : rôle du signataire introuvable (renseignez ODOO_SIGN_ROLE_ID)');
  const ref = `Souscription ${d.reference_bancaire || fullName(d)}`;
  const res = await o.call('sign.request', 'initialize_new', [tpl, [{ role, partner_id: partner }], [], ref, `Bulletin de souscription : ${fullName(d)}`, 'Bonjour, merci de signer votre bulletin de souscription de parts de la Brasserie coopérative liégeoise.'], { send: true });
  const id = res && typeof res === 'object' ? res.id : res;
  if (!id) throw new Error('Odoo Sign : demande non créée');
  return { ok: true, requestId: String(id), message: 'Demande de signature envoyée via Odoo Sign' };
}

export async function odooSignRemind(requestId: string): Promise<ConnectorResult> {
  if (isSim(requestId) || !config().odoo) return { ok: true, simulation: true, message: 'Simulation : rappel non envoyé' };
  const o = new Odoo(); const rid = Number(requestId);
  const items: number[] = await o.call('sign.request.item', 'search', [[['sign_request_id', '=', rid], ['state', '=', 'sent']]]);
  if (!items.length) return { ok: false, message: 'Aucun signataire en attente (document déjà signé ou annulé)' };
  let last = '';
  for (const m of ['send_signature_accesses', 'resend_access']) {
    try { await o.call('sign.request.item', m, [items]); return { ok: true, message: 'Rappel envoyé via Odoo Sign' }; } catch (e: any) { last = e.message; }
  }
  throw new Error('Rappel impossible avec cette version d’Odoo (' + last + ')');
}

/** État d'une demande de signature : 'envoye' | 'signe' | 'annule' */
export async function odooSignStatus(requestId: string): Promise<{ ok: boolean; statut?: 'envoye' | 'signe' | 'annule'; simulation?: boolean; message: string }> {
  if (isSim(requestId) || !config().odoo) return { ok: true, simulation: true, message: 'Simulation : statut inchangé' };
  const o = new Odoo(); const r = await o.call('sign.request', 'read', [[Number(requestId)], ['state']]);
  if (!r.length) return { ok: false, message: 'Demande de signature introuvable dans Odoo' };
  const s = r[0].state; return { ok: true, statut: s === 'signed' ? 'signe' : s === 'canceled' || s === 'refused' ? 'annule' : 'envoye', message: 'État lu dans Odoo : ' + s };
}

/** Odoo Mailing List : contact (mailing.contact) dans la liste « Coopérateurs » */
export async function odooMailingSync(d: Dem): Promise<ConnectorResult> {
  if (!d.email) return { ok: false, message: 'Pas d’adresse e-mail : contact non synchronisé' };
  if (!config().odoo) return { ok: true, simulation: true, message: 'Simulation : contact non envoyé à la liste Odoo (ODOO_URL / ODOO_API_KEY absents)' };
  const o = new Odoo(); const nom = process.env.ODOO_MAILING_LIST_NAME || 'Coopérateurs';
  let l: number[] = await o.call('mailing.list', 'search', [[['name', '=', nom]]], { limit: 1 });
  const listId = l.length ? l[0] : await o.call('mailing.list', 'create', [{ name: nom }]);
  const c: number[] = await o.call('mailing.contact', 'search', [[['email', '=ilike', d.email.trim()]]], { limit: 1 });
  if (c.length) await o.call('mailing.contact', 'write', [[c[0]], { name: fullName(d), list_ids: [[4, listId]] }]);
  else await o.call('mailing.contact', 'create', [{ name: fullName(d), email: d.email.trim(), list_ids: [[4, listId]] }]);
  return { ok: true, message: `Contact ajouté à la liste Odoo « ${nom} »` };
}

/* ===================== Brevo ===================== */
const brevoHead = () => ({ 'api-key': process.env.BREVO_API_KEY || '', 'content-type': 'application/json', accept: 'application/json' });

export async function brevoSync(d: Dem): Promise<ConnectorResult> {
  if (!d.email) return { ok: false, message: 'Pas d’adresse e-mail : contact non synchronisé' };
  if (!config().brevo) return { ok: true, simulation: true, message: 'Simulation : contact non envoyé à Brevo (BREVO_API_KEY absente)' };
  const listId = Number(process.env.BREVO_LIST_ID || 0);
  const r = await http('https://api.brevo.com/v3/contacts', { method: 'POST', headers: brevoHead(), body: JSON.stringify({ email: d.email.trim(), attributes: { PRENOM: d.prenom || d.representant || '', NOM: d.nom }, ...(listId ? { listIds: [listId] } : {}), updateEnabled: true }) });
  if (r.status === 201 || r.status === 204) return { ok: true, message: 'Contact créé ou mis à jour dans Brevo' };
  const t = await r.text(); throw new Error(`Brevo : HTTP ${r.status} ${t.slice(0, 160)}`);
}

/** Envoi du certificat par e-mail (API transactionnelle Brevo) */
export async function brevoEnvoyerCertificat(to: { email: string; nom: string }, pdf: Uint8Array, fichier: string): Promise<ConnectorResult> {
  if (!config().brevo || !process.env.BREVO_SENDER_EMAIL) return { ok: true, simulation: true, message: 'Simulation : e-mail non envoyé (BREVO_API_KEY et BREVO_SENDER_EMAIL requis)' };
  const body = {
    sender: { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME || 'La Badjawe' }, to: [{ email: to.email, name: to.nom }],
    subject: 'Votre certificat de parts sociales : Brasserie coopérative liégeoise',
    htmlContent: `<p>Bonjour ${to.nom.replace(/[<>&]/g, '')},</p><p>Merci de votre soutien ! Vous trouverez en pièce jointe votre certificat nominatif de parts sociales.</p><p>Cordialement,<br/>La Badjawe, brasserie coopérative</p>`,
    attachment: [{ name: fichier, content: Buffer.from(pdf).toString('base64') }],
  };
  const r = await http('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: brevoHead(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Brevo : HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  return { ok: true, message: 'Certificat envoyé par e-mail à ' + to.email };
}
