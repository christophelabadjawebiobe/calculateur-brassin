// lib/cooperateurs/demo.ts : « Mode Démo / Présentation » : masquage à la volée des données personnelles, SANS aucune modification en base.
// Le masquage est appliqué sur une copie du Store (nom, e-mail, téléphone, numéros, adresse, bénéficiaire, profil) : les montants, parts,
// numéros de certificats, dates et communes restent visibles pour que la démonstration reste parlante. Le Store masqué est en lecture seule.
import type { Cooperateur, Demande } from './types';
import { anonEmail, anonNom, anonNumero, anonTel } from './export';

const point = (s: string | null | undefined): string | null => (s && String(s).trim() ? '••••••' : null);
const anneeSeule = (d: string | null | undefined): string | null => (d && /^\d{4}/.test(d) ? d.slice(0, 4) + '-01-01' : d || null);

export function masquerCooperateur(c: Cooperateur): Cooperateur {
  return {
    ...c,
    nom: anonNom(c.nom), prenom: c.prenom ? anonNom(c.prenom) : c.prenom, representant: c.representant ? anonNom(c.representant) : c.representant,
    numero_identification: c.numero_identification ? anonNumero(c.numero_identification) : null,
    remarques: point(c.remarques), profession: point(c.profession), competences: point(c.competences),
    beneficiaire_nom: c.beneficiaire_nom ? anonNom(c.beneficiaire_nom) : null, beneficiaire_prenom: c.beneficiaire_prenom ? anonNom(c.beneficiaire_prenom) : null,
    beneficiaire_email: c.beneficiaire_email ? anonEmail(c.beneficiaire_email) : null, beneficiaire_date_naissance: anneeSeule(c.beneficiaire_date_naissance),
    contacts: (c.contacts || []).map((x) => ({ ...x, valeur: x.type === 'email' ? anonEmail(x.valeur) : anonTel(x.valeur) })),
    adresses: (c.adresses || []).map((a) => ({ ...a, rue: a.rue ? '•••••' : null, numero: null })),
  };
}

export function masquerDemande(d: Demande): Demande {
  return {
    ...d,
    nom: anonNom(d.nom), prenom: d.prenom ? anonNom(d.prenom) : d.prenom, representant: d.representant ? anonNom(d.representant) : d.representant,
    email: d.email ? anonEmail(d.email) : d.email, telephone: d.telephone ? anonTel(d.telephone) : d.telephone,
    rue: d.rue ? '•••••' : null, numero: null, numero_national: d.numero_national ? anonNumero(d.numero_national) : null,
    profession: point(d.profession), competences: point(d.competences),
    beneficiaire_nom: d.beneficiaire_nom ? anonNom(d.beneficiaire_nom) : null, beneficiaire_prenom: d.beneficiaire_prenom ? anonNom(d.beneficiaire_prenom) : null,
    beneficiaire_email: d.beneficiaire_email ? anonEmail(d.beneficiaire_email) : null, beneficiaire_date_naissance: anneeSeule(d.beneficiaire_date_naissance),
    donnees_brutes: null,
  };
}

/** Copie masquée d'un Store (générique pour ne pas dépendre de data.ts) : lecture seule, drapeau demo = true */
export function masquerStore<S extends { coops: Cooperateur[]; demandes: Demande[]; canWrite: boolean }>(s: S): S & { demo: true } {
  return { ...s, coops: s.coops.map(masquerCooperateur), demandes: s.demandes.map(masquerDemande), canWrite: false, demo: true };
}

/** Texte libre du journal (libellé, valeurs avant/après) : jamais affiché en mode démo */
export const DEMO_JOURNAL_MASQUE = '(détail masqué en mode démo)';
