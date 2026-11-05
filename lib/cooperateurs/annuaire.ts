// lib/cooperateurs/annuaire.ts : annuaire des compétences et talents des coopérateurs (fonctions pures, testables sans navigateur)
// Règle RGPD stricte (identique à la vue SQL v_annuaire_competences, sql/13) : une fiche n'est listée QUE SI
//   1. son profil provient d'un Google Form complété (profil_source = 'google_form') avec un métier ou des compétences,
//   2. la personne a explicitement répondu « Oui » à l'accord de contact téléphonique (accord_contact_tel === true ; « Non » ou vide = exclu),
//   3. elle détient encore des parts (sociétaire actif).
import type { Cooperateur } from './types';

export type FicheAnnuaire = {
  id: number; certificat: number | null; nom: string; prenom: string; nomComplet: string; profession: string; competences: string;
  tags: { cle: string; label: string }[]; telephone: string; email: string; parts: number; recherche: string;
};
export type Facette = { cle: string; label: string; n: number };

/** minuscules sans accents, espaces simples : sert à la recherche et au regroupement */
export const cle = (s: string): string => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim();
const partsDe = (c: Cooperateur): number => (c.mouvements_parts || []).reduce((s: number, m) => s + m.nombre_parts, 0);
const vide = (s: string | null | undefined): boolean => !String(s || '').trim();

/** la règle d'éligibilité, en un seul endroit */
export function estDansAnnuaire(c: Cooperateur): boolean {
  return c.profil_source === 'google_form' && c.accord_contact_tel === true && !(vide(c.profession) && vide(c.competences)) && partsDe(c) > 0;
}

/** « menuiserie, électricité et droit » -> 3 étiquettes (séparateurs : virgule, point-virgule, barre, retour à la ligne, « / », « et ») */
export function decouperTags(texte: string | null | undefined): { cle: string; label: string }[] {
  const vus = new Set<string>(); const out: { cle: string; label: string }[] = [];
  String(texte || '').split(/[,;|\n\r•·]+|\s\/\s|\/(?=\s)|\s+et\s+|\s+&\s+/i).forEach((p: string) => {
    const t = p.replace(/^[\s\-–—.]+|[\s.]+$/g, '').trim(); if (t.length < 2 || t.length > 60) return;
    const k = cle(t); if (!k || vus.has(k)) return; vus.add(k); out.push({ cle: k, label: t.charAt(0).toUpperCase() + t.slice(1) });
  });
  return out;
}

export function construireAnnuaire(coops: Cooperateur[], telDe: (c: Cooperateur) => string, emailDe: (c: Cooperateur) => string, nomComplet: (c: Cooperateur) => string): FicheAnnuaire[] {
  return coops.filter(estDansAnnuaire).map((c: Cooperateur): FicheAnnuaire => {
    const profession = String(c.profession || '').trim(), competences = String(c.competences || '').trim(), prenom = String(c.prenom || '');
    return {
      id: c.id, certificat: c.certificat, nom: c.nom, prenom, nomComplet: nomComplet(c), profession, competences, tags: decouperTags(competences),
      telephone: telDe(c), email: emailDe(c), parts: partsDe(c), recherche: cle([c.nom, prenom, c.representant, profession, competences].join(' ')),
    };
  }).sort((a: FicheAnnuaire, b: FicheAnnuaire) => a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr'));
}

/** termes récurrents, du plus fréquent au moins fréquent (pour filtrer en un clic) */
export function facettesTags(f: FicheAnnuaire[]): Facette[] {
  const m = new Map<string, Facette>();
  f.forEach((x: FicheAnnuaire) => x.tags.forEach((t) => { const e = m.get(t.cle); if (e) e.n++; else m.set(t.cle, { cle: t.cle, label: t.label, n: 1 }); }));
  return [...m.values()].sort((a: Facette, b: Facette) => b.n - a.n || a.label.localeCompare(b.label, 'fr'));
}
export function facettesMetiers(f: FicheAnnuaire[]): Facette[] {
  const m = new Map<string, Facette>();
  f.forEach((x: FicheAnnuaire) => { const k = cle(x.profession); if (!k) return; const e = m.get(k); if (e) e.n++; else m.set(k, { cle: k, label: x.profession.charAt(0).toUpperCase() + x.profession.slice(1), n: 1 }); });
  return [...m.values()].sort((a: Facette, b: Facette) => b.n - a.n || a.label.localeCompare(b.label, 'fr'));
}

export type Filtre = { q: string; tags: string[]; tous: boolean; metier: string };
export function filtrer(f: FicheAnnuaire[], o: Filtre): FicheAnnuaire[] {
  const mots = cle(o.q).split(' ').filter(Boolean);   // chaque mot doit se retrouver (nom, prénom, métier ou compétences)
  return f.filter((x: FicheAnnuaire) => {
    if (mots.some((w: string) => !x.recherche.includes(w))) return false;
    if (o.metier && cle(x.profession) !== o.metier) return false;
    if (o.tags.length) { const mine = new Set(x.tags.map((t) => t.cle)); const hit = (k: string) => mine.has(k); if (o.tous ? !o.tags.every(hit) : !o.tags.some(hit)) return false; }
    return true;
  });
}

export const ENTETES_ANNUAIRE = ['Nom', 'Prénom', 'Métier / Profession', 'Compétences & talents', 'Téléphone', 'E-mail', 'Parts détenues'];
export const lignesAnnuaire = (f: FicheAnnuaire[]): (string | number)[][] => f.map((x: FicheAnnuaire) => [x.nom, x.prenom, x.profession, x.competences, x.telephone, x.email, x.parts]);
/** numéro utilisable dans un lien tel: (chiffres et +) */
export const lienTel = (t: string): string => 'tel:' + String(t || '').replace(/[^\d+]/g, '');
