'use server';
// app/admin/users/actions.ts : actions serveur de l'administration (utilisateurs, invitations, rôles et droits).
// Chaque action revérifie côté serveur que l'appelant est administrateur (is_admin()) : l'interface n'est qu'un confort.
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, createImplicitClient } from '@/lib/supabase/admin';

import { APP_KEYS, LEVELS, type AppKey, type Result } from '@/lib/types';

const BUILTIN_ROLES: string[] = ['admin', 'brasseur', 'user'];
const fail = (message: string): Result => ({ ok: false, message });
const ok = (message: string, extra?: Partial<Result>): Result => ({ ok: true, message, ...extra });
const NO_KEY = 'Cette action nécessite SUPABASE_SERVICE_ROLE_KEY dans les variables d’environnement (Vercel), puis un redéploiement.';
const NO_TABLES = 'Tables des rôles absentes : exécutez sql/05_roles_permissions.sql dans Supabase (SQL Editor).';

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;
type Caller = { ok: false; message: string } | { ok: true; supabase: SupabaseServer; user: { id: string } };

async function caller(): Promise<Caller> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: 'Session expirée : reconnectez-vous.' };
  const { data: admin, error } = await supabase.rpc('is_admin');
  if (error) return { ok: false, message: 'Vérification des droits impossible : ' + error.message };
  if (!admin) return { ok: false, message: 'Action réservée aux administrateurs.' };
  return { ok: true, supabase, user };
}

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || (host && host.startsWith('localhost') ? 'http' : 'https');
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || (host ? `${proto}://${host}` : '');
}

async function roleExists(c: { supabase: SupabaseServer }, role: string): Promise<boolean> {
  const db = createAdminClient() ?? c.supabase;
  const { data, error } = await db.from('roles').select('id').eq('id', role).maybeSingle();
  if (error) return BUILTIN_ROLES.includes(role); // table des rôles absente : rôles d'origine seulement
  return Boolean(data);
}

async function emailOf(userId: string, c: { supabase: SupabaseServer }): Promise<string | null> {
  const admin = createAdminClient();
  if (admin) { const { data } = await admin.auth.admin.getUserById(userId); if (data && data.user && data.user.email) return data.user.email; }
  const { data } = await c.supabase.from('profiles').select('email').eq('id', userId).maybeSingle();
  return data && (data as { email?: string }).email ? (data as { email: string }).email : null;
}

async function adminCount(c: { supabase: SupabaseServer }): Promise<number> {
  const db = createAdminClient() ?? c.supabase;
  const { count } = await db.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin');
  return count ?? 0;
}

/* ------------------------------------------------------------------ utilisateurs */

export async function inviteUser(input: { email: string; name: string; role: string }): Promise<Result> {
  const c = await caller(); if (!c.ok) return fail(c.message);
  const email = String(input.email || '').trim().toLowerCase();
  const name = String(input.name || '').trim();
  const role = String(input.role || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Adresse e-mail invalide.');
  if (!name) return fail('Le nom complet est obligatoire.');
  if (!(await roleExists(c, role))) return fail('Rôle inconnu.');
  const supabaseAdmin = createAdminClient();
  if (!supabaseAdmin) return fail(NO_KEY);
  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, { data: { name, full_name: name, role }, redirectTo: (await siteOrigin()) + '/reset-password' });
  if (error) return fail(/already|registered|exists/i.test(error.message) ? 'Un compte existe déjà avec cette adresse e-mail.' : error.message);
  const id = data && data.user ? data.user.id : null;
  if (!id) return fail('Invitation envoyée, mais Supabase n’a pas renvoyé d’identifiant : créez la fiche à la main.');
  let up = await supabaseAdmin.from('profiles').upsert({ id, email, full_name: name, role }, { onConflict: 'id' });
  if (up.error) up = await supabaseAdmin.from('profiles').upsert({ id, full_name: name, role }, { onConflict: 'id' }); // table sans colonne email
  if (up.error) return fail('Invitation envoyée, mais la fiche profil n’a pas pu être créée : ' + up.error.message);
  revalidatePath('/admin/users');
  return ok(`Invitation envoyée à ${email}.`);
}

export async function resendInvite(userId: string): Promise<Result> {
  const c = await caller(); if (!c.ok) return fail(c.message);
  const supabaseAdmin = createAdminClient(); if (!supabaseAdmin) return fail(NO_KEY);
  const email = await emailOf(userId, c); if (!email) return fail('Adresse e-mail introuvable.');
  const redirectTo = (await siteOrigin()) + '/reset-password';
  const { data: p } = await supabaseAdmin.from('profiles').select('full_name,role').eq('id', userId).maybeSingle();
  const meta = p as { full_name?: string; role?: string } | null;
  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, { data: { name: meta?.full_name ?? '', full_name: meta?.full_name ?? '', role: meta?.role ?? 'user' }, redirectTo });
  if (!error) return ok(`Invitation renvoyée à ${email}.`);
  const gen = await supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
  const link = gen.data && gen.data.properties ? gen.data.properties.action_link : undefined;
  return link ? ok(`L’e-mail n’a pas pu être renvoyé (${error.message}). Lien à transmettre à ${email} :`, { link }) : fail(error.message);
}

export async function setSuspended(userId: string, suspended: boolean): Promise<Result> {
  const c = await caller(); if (!c.ok) return fail(c.message);
  if (userId === c.user.id) return fail('Vous ne pouvez pas suspendre votre propre compte.');
  const supabaseAdmin = createAdminClient(); if (!supabaseAdmin) return fail(NO_KEY);
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: suspended ? '876000h' : 'none' } as { ban_duration: string });
  if (error) return fail(error.message);
  revalidatePath('/admin/users');
  return ok(suspended ? 'Compte suspendu : la connexion est bloquée.' : 'Compte réactivé.');
}

export async function deleteUser(userId: string): Promise<Result> {
  const c = await caller(); if (!c.ok) return fail(c.message);
  if (userId === c.user.id) return fail('Vous ne pouvez pas supprimer votre propre compte.');
  const supabaseAdmin = createAdminClient(); if (!supabaseAdmin) return fail(NO_KEY);
  const { data: p } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (p && (p as { role?: string }).role === 'admin' && (await adminCount(c)) <= 1) return fail('Impossible de supprimer le dernier administrateur.');
  await supabaseAdmin.from('user_app_permissions').delete().eq('user_id', userId);
  await supabaseAdmin.from('profiles').delete().eq('id', userId);
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) return fail(error.message);
  revalidatePath('/admin/users');
  return ok('Compte supprimé.');
}

export async function setRole(userId: string, role: string): Promise<Result> {
  const c = await caller(); if (!c.ok) return fail(c.message);
  if (!(await roleExists(c, role))) return fail('Rôle inconnu.');
  if (userId === c.user.id && role !== 'admin') return fail('Vous ne pouvez pas retirer votre propre rôle d’administrateur (demandez à un autre administrateur).');
  const db = createAdminClient() ?? c.supabase;
  const { data, error } = await db.from('profiles').update({ role }).eq('id', userId).select('id');
  if (error) return fail(error.message);
  if (!data || !data.length) return fail('Profil introuvable (ou modification refusée par la base : exécutez sql/04 et sql/05).');
  revalidatePath('/admin/users');
  return ok(`Rôle « ${role} » enregistré.`);
}

/** mode « email » : Supabase envoie le message de réinitialisation ; mode « link » : génère un lien à transmettre soi-même */
export async function resetPassword(userId: string, mode: 'email' | 'link'): Promise<Result> {
  const c = await caller(); if (!c.ok) return fail(c.message);
  const email = await emailOf(userId, c);
  if (!email) return fail('Adresse e-mail introuvable pour cet utilisateur.');
  const redirectTo = (await siteOrigin()) + '/reset-password';
  if (mode === 'link') {
    const admin = createAdminClient();
    if (!admin) return fail(NO_KEY);
    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
    if (error) return fail(error.message);
    const link = data && data.properties ? data.properties.action_link : undefined;
    return link ? ok(`Lien de réinitialisation pour ${email} (valable 1 heure) :`, { link }) : fail('Supabase n’a renvoyé aucun lien.');
  }
  const { error } = await createImplicitClient().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) return fail(/rate|seconds/i.test(error.message) ? 'Trop de demandes rapprochées : patientez une minute avant de réessayer.' : error.message);
  return ok(`E-mail de réinitialisation envoyé à ${email}.`);
}

export async function setTemporaryPassword(userId: string, password: string): Promise<Result> {
  const c = await caller(); if (!c.ok) return fail(c.message);
  if (typeof password !== 'string' || password.length < 8) return fail('Le mot de passe doit contenir au moins 8 caractères.');
  const admin = createAdminClient();
  if (!admin) return fail(NO_KEY);
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return fail(error.message);
  return ok('Mot de passe défini. Transmettez-le à l’utilisateur par un canal sûr et invitez-le à le changer.');
}

/* ------------------------------------------------------------------ rôles et droits */

export async function createRole(input: { id: string; name: string; description: string }): Promise<Result> {
  const c = await caller(); if (!c.ok) return fail(c.message);
  const id = String(input.id || '').trim().toLowerCase();
  const name = String(input.name || '').trim();
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(id)) return fail('Identifiant invalide : 2 à 31 caractères, minuscules, chiffres et _, commençant par une lettre.');
  if (!name) return fail('Le nom du rôle est obligatoire.');
  const db = createAdminClient() ?? c.supabase;
  const ins = await db.from('roles').insert({ id, name, description: String(input.description || '').trim() || null, is_system: false });
  if (ins.error) return fail(/duplicate|unique/i.test(ins.error.message) ? 'Un rôle avec cet identifiant existe déjà.' : /relation|does not exist|schema cache/i.test(ins.error.message) ? NO_TABLES : ins.error.message);
  const perms = APP_KEYS.map((app_key: AppKey) => ({ role_id: id, app_key, level: 'none' }));
  const p = await db.from('role_permissions').insert(perms);
  if (p.error) return fail('Rôle créé, mais ses droits n’ont pas pu être initialisés : ' + p.error.message);
  revalidatePath('/admin/users');
  return ok(`Rôle « ${name} » créé : aucun accès par défaut, réglez la matrice ci-dessous.`);
}

export async function setRolePermission(roleId: string, appKey: string, level: string): Promise<Result> {
  const c = await caller(); if (!c.ok) return fail(c.message);
  if (roleId === 'admin') return fail('Le rôle administrateur a toujours tous les droits.');
  if (!(APP_KEYS as readonly string[]).includes(appKey)) return fail('Application inconnue.');
  if (!(LEVELS as readonly string[]).includes(level)) return fail('Niveau d’accès inconnu.');
  if (!(await roleExists(c, roleId))) return fail('Rôle inconnu.');
  const db = createAdminClient() ?? c.supabase;
  const { error } = await db.from('role_permissions').upsert({ role_id: roleId, app_key: appKey, level }, { onConflict: 'role_id,app_key' });
  if (error) return fail(/relation|does not exist|schema cache/i.test(error.message) ? NO_TABLES : error.message);
  revalidatePath('/admin/users');
  return ok('Droits enregistrés.');
}

export async function deleteRole(roleId: string): Promise<Result> {
  const c = await caller(); if (!c.ok) return fail(c.message);
  if (BUILTIN_ROLES.includes(roleId)) return fail('Les rôles admin, brasseur et user ne peuvent pas être supprimés.');
  const db = createAdminClient() ?? c.supabase;
  const { data: r } = await db.from('roles').select('id,is_system').eq('id', roleId).maybeSingle();
  if (!r) return fail('Rôle introuvable.');
  if ((r as { is_system?: boolean }).is_system) return fail('Ce rôle système ne peut pas être supprimé.');
  const { count } = await db.from('profiles').select('id', { count: 'exact', head: true }).eq('role', roleId);
  if ((count ?? 0) > 0) return fail(`${count} utilisateur(s) ont encore ce rôle : changez d’abord leur rôle.`);
  const { error } = await db.from('roles').delete().eq('id', roleId);
  if (error) return fail(error.message);
  revalidatePath('/admin/users');
  return ok('Rôle supprimé.');
}
