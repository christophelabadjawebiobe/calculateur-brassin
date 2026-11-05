// lib/cooperateurs/connectors.ts : connecteurs externes du module Coopérateurs (SERVEUR UNIQUEMENT : clés d'API dans process.env)
//   Google Sheet : GOOGLE_SHEET_ID + (recommandé) compte de service : GOOGLE_SERVICE_ACCOUNT_JSON, ou GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY  (feuille privée partagée avec le compte de service)
//                  ou GOOGLE_API_KEY (feuille « toute personne disposant du lien »), ou rien (export CSV public) ; GOOGLE_SHEET_NAME / GOOGLE_SHEET_GID facultatifs
//   Odoo         : ODOO_URL, ODOO_API_KEY (+ ODOO_DB, ODOO_USER, ODOO_SIGN_TEMPLATE_ID, ODOO_SIGN_ROLE_ID, ODOO_MAILING_LIST_NAME)
//   Brevo        : BREVO_API_KEY (+ BREVO_LIST_ID, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME)
// Chaque connecteur a un MODE SIMULATION (variables absentes) : aucune requête externe, résultat factice mais cohérent (identifiants « SIM-… »).
import { createSign } from 'node:crypto';
import { mapHeaders, parseCsv } from './sheet';
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
type Compte = { email: string; key: string };
/** Compte de service Google : JSON complet (GOOGLE_SERVICE_ACCOUNT_JSON) ou e-mail + clé privée (les « \\n » de Vercel sont convertis en vrais retours à la ligne) */
export function compteGoogle(): Compte | null {
  const j = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (j) { try { const o = JSON.parse(j); if (o.client_email && o.private_key) return { email: String(o.client_email), key: String(o.private_key) }; } catch { /* JSON invalide : ignoré, signalé par le diagnostic */ } }
  const e = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, k = process.env.GOOGLE_PRIVATE_KEY;
  return e && k ? { email: e, key: k.replace(/\\n/g, '\n').replace(/^"|"$/g, '') } : null;
}
const b64u = (x: string | Buffer): string => Buffer.from(x).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
let jeton: { v: string; exp: number; cle: string } | null = null;
/** Jeton d'accès OAuth2 (JWT RS256 signé avec la clé du compte de service, lecture seule des feuilles de calcul) : mis en cache ~55 min */
export async function jetonGoogle(c: Compte, maintenant = Date.now()): Promise<string> {
  const cle = c.email + '|' + c.key.slice(-60);
  if (jeton && jeton.cle === cle && jeton.exp > maintenant + 60000) return jeton.v;
  const iat = Math.floor(maintenant / 1000);
  const corps = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64u(JSON.stringify({ iss: c.email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
  let sig: string;
  try { sig = b64u(createSign('RSA-SHA256').update(corps).sign(c.key)); } catch { throw new Error('Clé privée du compte de service illisible (GOOGLE_PRIVATE_KEY / GOOGLE_SERVICE_ACCOUNT_JSON : collez la clé complète, avec -----BEGIN PRIVATE KEY-----)'); }
  const r = await http('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + corps + '.' + sig });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Google : compte de service refusé (' + (j.error_description || j.error || 'HTTP ' + r.status) + ')');
  jeton = { v: j.access_token, cle, exp: maintenant + (Number(j.expires_in) || 3600) * 1000 - 300000 };
  return jeton.v;
}
export type ModeGoogle = 'compte_de_service' | 'cle_api' | 'lien_public';
export const modeGoogle = (): ModeGoogle => (compteGoogle() ? 'compte_de_service' : process.env.GOOGLE_API_KEY ? 'cle_api' : 'lien_public');

export async function lireGoogleSheet(): Promise<string[][]> {
  const id = process.env.GOOGLE_SHEET_ID!, key = process.env.GOOGLE_API_KEY, nom = process.env.GOOGLE_SHEET_NAME, gid = process.env.GOOGLE_SHEET_GID || '0';
  const compte = compteGoogle();
  if (compte || key) {
    const range = encodeURIComponent(nom ? `'${nom.replace(/'/g, "''")}'!A:ZZ` : 'A:ZZ');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${range}?valueRenderOption=FORMATTED_VALUE` + (compte ? '' : `&key=${encodeURIComponent(key as string)}`);
    const r = await http(url, compte ? { headers: { authorization: 'Bearer ' + (await jetonGoogle(compte)) } } : {});
    if (!r.ok) {
      if (compte && (r.status === 403 || r.status === 404)) throw new Error(`Google Sheets API : HTTP ${r.status} : partagez la feuille (bouton Partager, rôle Lecteur) avec ${compte.email}, et vérifiez GOOGLE_SHEET_ID`);
      throw new Error(`Google Sheets API : HTTP ${r.status} (clé, identifiant, nom de l’onglet ou partage du Sheet ?)`);
    }
    const j: any = await r.json(); return (j.values || []) as string[][];
  }
  const r = await http(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/export?format=csv&gid=${encodeURIComponent(gid)}`);
  if (!r.ok) throw new Error(`Export du Sheet impossible (HTTP ${r.status}) : configurez un compte de service (recommandé), ou partagez le Sheet « toute personne disposant du lien »`);
  const txt = await r.text();
  if (/^\s*<!doctype html|<html/i.test(txt.slice(0, 200))) throw new Error('Le Sheet est privé : configurez un compte de service Google (GOOGLE_SERVICE_ACCOUNT_JSON) et partagez-le avec lui');
  return parseCsv(txt);
}

/* ===================== Odoo (JSON-RPC) ===================== */
type Dem = { id?: string; nom: string; prenom?: string | null; email?: string | null; telephone?: string | null; representant?: string | null; reference_bancaire?: string | null; odoo_sign_request_id?: string | null; consentement_newsletter?: boolean | null };
const fullName = (d: Dem): string => [d.prenom, d.nom].filter(Boolean).join(' ') + (d.representant && !d.prenom ? ` (${d.representant})` : '');

export class Odoo {
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
  if (!d.consentement_newsletter) return { ok: true, ignore: true, message: 'Newsletter : pas de consentement, contact non envoyé à la liste Odoo' };
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
  if (!d.consentement_newsletter) return { ok: true, ignore: true, message: 'Newsletter : pas de consentement, contact non envoyé à Brevo' };
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


/* ===================== Diagnostic (administrateur) : « Tester les connecteurs » ===================== */
export type Etape = { ok: boolean; libelle: string; detail?: string };
export type Diag = { service: 'google' | 'odoo' | 'brevo'; configure: boolean; ok: boolean; etapes: Etape[]; aide: string[] };
const msg = (e: any): string => (e && e.message ? String(e.message) : 'erreur');
const etape = async (etapes: Etape[], libelle: string, f: () => Promise<string | void>): Promise<boolean> => {
  try { const d = await f(); etapes.push({ ok: true, libelle, detail: d || undefined }); return true; } catch (e: any) { etapes.push({ ok: false, libelle, detail: msg(e) }); return false; }
};
const REQUIS: [string, string][] = [['nom', 'nom'], ['email', 'e-mail'], ['nombre_parts', 'nombre de parts']];
const UTILES: [string, string][] = [['prenom', 'prénom'], ['telephone', 'téléphone'], ['rue', 'rue'], ['numero_rue', 'numéro'], ['code_postal', 'code postal'], ['ville', 'commune'], ['numero_national', 'n° national / entreprise'], ['type', 'type de souscripteur'], ['date', 'horodatage']];

export async function diagnosticGoogle(): Promise<Diag> {
  const d: Diag = { service: 'google', configure: config().google, ok: false, etapes: [], aide: [] };
  if (!d.configure) { d.etapes.push({ ok: false, libelle: 'GOOGLE_SHEET_ID absent', detail: 'mode simulation (aucune lecture réelle)' }); return d; }
  const mode = modeGoogle();
  d.etapes.push({ ok: true, libelle: 'Mode d’accès', detail: mode === 'compte_de_service' ? `compte de service ${(compteGoogle() as Compte).email}` : mode === 'cle_api' ? 'clé API (feuille partagée par lien)' : 'export CSV public (feuille partagée par lien)' });
  if (mode !== 'compte_de_service' && (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL)) d.etapes.push({ ok: false, libelle: 'Compte de service incomplet', detail: 'GOOGLE_SERVICE_ACCOUNT_JSON invalide, ou GOOGLE_PRIVATE_KEY manquante' });
  let table: string[][] = [];
  const lu = await etape(d.etapes, 'Lecture de la feuille', async () => { table = await lireGoogleSheet(); if (!table.length) throw new Error('feuille vide'); return `${table.length - 1} réponse(s), ${table[0].length} colonne(s)`; });
  if (lu) {
    const map = mapHeaders(table[0]); const manque = REQUIS.filter((r) => !(r[0] in map)).map((r) => r[1]);
    d.etapes.push({ ok: manque.length === 0, libelle: 'Colonnes obligatoires reconnues', detail: manque.length ? 'manque : ' + manque.join(', ') : 'nom, e-mail, nombre de parts' });
    const ok2 = UTILES.filter((r) => r[0] in map).map((r) => r[1]), ko2 = UTILES.filter((r) => !(r[0] in map)).map((r) => r[1]);
    d.etapes.push({ ok: true, libelle: 'Colonnes facultatives', detail: (ok2.length ? 'reconnues : ' + ok2.join(', ') : 'aucune') + (ko2.length ? ' · non trouvées : ' + ko2.join(', ') : '') });
    const idx = new Set(Object.values(map)); const ign = table[0].filter((h: string, i: number) => h && !idx.has(i));
    if (ign.length) d.aide.push('En-têtes non utilisés (ignorés) : ' + ign.slice(0, 12).join(' | '));
  }
  d.ok = d.etapes.every((e) => e.ok); return d;
}

export async function diagnosticOdoo(): Promise<Diag> {
  const d: Diag = { service: 'odoo', configure: config().odoo, ok: false, etapes: [], aide: [] };
  if (!d.configure) { d.etapes.push({ ok: false, libelle: 'ODOO_URL / ODOO_API_KEY absents', detail: 'mode simulation (aucun appel à Odoo)' }); return d; }
  const o = new Odoo();
  if (!o.user) d.etapes.push({ ok: false, libelle: 'ODOO_USER absent', detail: 'identifiant (e-mail de connexion) de l’utilisateur propriétaire de la clé API' });
  const co = await etape(d.etapes, 'Connexion JSON-RPC et authentification', async () => { await o.login(); return `base « ${o.db} », utilisateur n° ${o.uid}`; });
  if (co) {
    const tpl = Number(process.env.ODOO_SIGN_TEMPLATE_ID || 0);
    await etape(d.etapes, 'Modèle de signature (sign.template)', async () => {
      if (tpl) { const r = await o.call('sign.template', 'read', [[tpl], ['name']]); if (!r.length) throw new Error('modèle n° ' + tpl + ' introuvable'); return `n° ${tpl} : ${r[0].name}`; }
      const l = await o.call('sign.template', 'search_read', [[]], { fields: ['name'], limit: 30, order: 'id desc' });
      d.aide.push('Modèles disponibles (ODOO_SIGN_TEMPLATE_ID = le numéro) : ' + (l.map((x: any) => `${x.id} = ${x.name}`).join(' | ') || 'aucun'));
      throw new Error('ODOO_SIGN_TEMPLATE_ID non renseigné');
    });
    const role = Number(process.env.ODOO_SIGN_ROLE_ID || 0);
    await etape(d.etapes, 'Rôle du signataire (sign.item.role)', async () => {
      const l = await o.call('sign.item.role', 'search_read', [[]], { fields: ['name'], limit: 30 });
      if (role) { const r = l.find((x: any) => x.id === role); if (!r) throw new Error('rôle n° ' + role + ' introuvable'); return `n° ${role} : ${r.name}`; }
      d.aide.push('Rôles disponibles (ODOO_SIGN_ROLE_ID, facultatif : sinon lu dans le modèle) : ' + (l.map((x: any) => `${x.id} = ${x.name}`).join(' | ') || 'aucun'));
      return 'non renseigné : déduit du modèle à l’envoi';
    });
    const liste = process.env.ODOO_MAILING_LIST_NAME || 'Coopérateurs';
    await etape(d.etapes, `Liste de diffusion « ${liste} » (mailing.list)`, async () => {
      const l = await o.call('mailing.list', 'search_read', [[]], { fields: ['name'], limit: 50 });
      d.aide.push('Listes Odoo existantes : ' + (l.map((x: any) => x.name).join(' | ') || 'aucune'));
      const t = l.find((x: any) => x.name === liste);
      if (!t) throw new Error('liste introuvable : elle sera créée automatiquement à la première synchronisation (ou ajustez ODOO_MAILING_LIST_NAME)');
      return 'n° ' + t.id;
    });
  }
  d.ok = d.etapes.every((e) => e.ok); return d;
}

export async function diagnosticBrevo(): Promise<Diag> {
  const d: Diag = { service: 'brevo', configure: config().brevo, ok: false, etapes: [], aide: [] };
  if (!d.configure) { d.etapes.push({ ok: false, libelle: 'BREVO_API_KEY absente', detail: 'mode simulation (aucun appel à Brevo)' }); return d; }
  const get = async (path: string): Promise<any> => { const r = await http('https://api.brevo.com/v3' + path, { headers: brevoHead() }); if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 401 ? ' : clé API refusée' : ''}`); return r.json(); };
  const c = await etape(d.etapes, 'Clé API', async () => { const a: any = await get('/account'); return `compte ${a.companyName || a.email || ''}`.trim(); });
  if (c) {
    const id = Number(process.env.BREVO_LIST_ID || 0);
    await etape(d.etapes, 'Liste de contacts cible (BREVO_LIST_ID)', async () => {
      const l: any = await get('/contacts/lists?limit=50&offset=0'); const ls: any[] = l.lists || [];
      d.aide.push('Listes Brevo (BREVO_LIST_ID = le numéro) : ' + (ls.map((x) => `${x.id} = ${x.name}`).join(' | ') || 'aucune'));
      if (!id) throw new Error('BREVO_LIST_ID non renseigné : les contacts seraient créés sans liste');
      const t = ls.find((x) => x.id === id); if (!t) throw new Error('liste n° ' + id + ' introuvable'); return `n° ${id} : ${t.name}`;
    });
    const exp = process.env.BREVO_SENDER_EMAIL;
    await etape(d.etapes, 'Expéditeur des certificats (BREVO_SENDER_EMAIL)', async () => {
      if (!exp) throw new Error('BREVO_SENDER_EMAIL non renseigné : l’envoi du certificat par e-mail restera simulé');
      const s: any = await get('/senders'); const t = (s.senders || []).find((x: any) => String(x.email).toLowerCase() === exp.toLowerCase());
      if (!t) throw new Error(exp + ' n’est pas un expéditeur déclaré dans Brevo (Expéditeurs, domaines et IP dédiées)');
      if (t.active === false) throw new Error(exp + ' est déclaré mais pas encore validé'); return exp;
    });
  }
  d.ok = d.etapes.every((e) => e.ok); return d;
}
