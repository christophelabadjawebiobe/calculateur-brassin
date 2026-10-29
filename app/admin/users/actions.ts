'use server';
// app/admin/users/actions.ts : actions serveur de l'administration des utilisateurs.
// Chaque action revérifie côté serveur que l'appelant est administrateur (is_admin()) : l'interface n'est qu'un confort.
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, createImplicitClient } from '@/lib/supabase/admin';

export const ROLES = ['admin', 'brasseur', 'user'] as const;
export type Role = (typeof ROLES)[number];
export type Result = { ok: boolean; message: string; link?: string };
const fail = (message: string): Result => ({ ok: false, message });

type Caller = { ok: false; message: string } | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; user: { id: string } };
async function caller(): Promise<Caller> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: 'Session expirée : reconnectez-vous.' };
  const { data: admin, error } = await supabase.rpc('is_admin');
  if (error) return { ok: false, message: 'Vérification des droits impossible : ' + error.message };
  if (!admin) return { ok: false, message: 'Action réservée aux administrateurs.' };
  return { ok: true, supabase, user };
}

async function siteOrigin() {
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || (host && host.startsWith('localhost') ? 'http' : 'https');
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || (host ? `${proto}://${host}` : '');
}

export async function setRole(userId: string, role: string): Promise<Result> {
  const c = await caller(); if (!c.ok) return fail(c.message);
  if (!(ROLES as readonly string[]).includes(role)) return fail('Rôle inconnu.');
  if (userId === c.user.id && role !== 'admin') return fail('Vous ne pouvez pas retirer votre propre rôle d’administrateur (demandez à un autre administrateur).');
  const db = createAdminClient() ?? c.supabase;
  const { data, error } = await db.from('profiles').update({ role }).eq('id', userId).select('id');
  if (error) return fail(error.message);
  if (!data || !data.length) return fail('Profil introuvable (ou modification refusée par la base : exécutez sql/04_admin_reel_validation.sql).');
  revalidatePath('/admin/users');
  return { ok: true, message: `Rôle « ${role} » enregistré.` };
}

export async function setAccess(userId: string, appId: string, allowed: boolean): Promise<Result> {
  const c = await caller(); if (!c.ok) return fail(c.message);
  const db = createAdminClient() ?? c.supabase;
  const up = await db.from('user_app_permissions').upsert({ user_id: userId, app_id: appId, has_access: allowed }, { onConflict: 'user_id,app_id' });
  if (up.error) {
    // pas de clé unique (user_id, app_id) dans la base : on retombe sur mise à jour puis insertion
    const upd = await db.from('user_app_permissions').update({ has_access: allowed }).eq('user_id', userId).eq('app_id', appId).select('user_id');
    if (upd.error) return fail(upd.error.message);
    if (!upd.data || !upd.data.length) { const ins = await db.from('user_app_permissions').insert({ user_id: userId, app_id: appId, has_access: allowed }); if (ins.error) return fail(ins.error.message); }
  }
  revalidatePath('/admin/users');
  return { ok: true, message: allowed ? 'Accès accordé.' : 'Accès retiré.' };
}

async function emailOf(userId: string, c: { supabase: Awaited<ReturnType<typeof createClient>> }): Promise<string | null> {
  const admin = createAdminClient();
  if (admin) { const { data } = await admin.auth.admin.getUserById(userId); if (data && data.user && data.user.email) return data.user.email; }
  const { data } = await c.supabase.from('profiles').select('email').eq('id', userId).maybeSingle();
  return data && (data as { email?: string }).email ? (data as { email: string }).email : null;
}

/** mode « email » : Supabase envoie le message de réinitialisation ; mode « link » : génère un lien à transmettre soi-même */
export async function resetPassword(userId: string, mode: 'email' | 'link'): Promise<Result> {
  const c = await caller(); if (!c.ok) return fail(c.message);
  const email = await emailOf(userId, c);
  if (!email) return fail('Adresse e-mail introuvable pour cet utilisateur.');
  const redirectTo = (await siteOrigin()) + '/reset-password';
  if (mode === 'link') {
    const admin = createAdminClient();
    if (!admin) return fail('Génération de lien impossible : ajoutez SUPABASE_SERVICE_ROLE_KEY dans les variables d’environnement (Vercel), puis redéployez.');
    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
    if (error) return fail(error.message);
    const link = data && data.properties ? data.properties.action_link : undefined;
    return link ? { ok: true, message: `Lien de réinitialisation pour ${email} (valable 1 heure) :`, link } : fail('Supabase n’a renvoyé aucun lien.');
  }
  const { error } = await createImplicitClient().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) return fail(/rate|seconds/i.test(error.message) ? 'Trop de demandes rapprochées : patientez une minute avant de réessayer.' : error.message);
  return { ok: true, message: `E-mail de réinitialisation envoyé à ${email}.` };
}

export async function setTemporaryPassword(userId: string, password: string): Promise<Result> {
  const c = await caller(); if (!c.ok) return fail(c.message);
  if (typeof password !== 'string' || password.length < 8) return fail('Le mot de passe doit contenir au moins 8 caractères.');
  const admin = createAdminClient();
  if (!admin) return fail('Définir un mot de passe nécessite SUPABASE_SERVICE_ROLE_KEY (variables d’environnement Vercel).');
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return fail(error.message);
  return { ok: true, message: 'Mot de passe défini. Transmettez-le à l’utilisateur par un canal sûr et invitez-le à le changer.' };
}
