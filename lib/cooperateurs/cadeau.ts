// lib/cooperateurs/cadeau.ts : parts offertes (cadeau / mineur) : fonctions pures d'affichage (aucun accès navigateur au chargement du module)
export type Benef = {
  est_cadeau?: boolean | null; beneficiaire_nom?: string | null; beneficiaire_prenom?: string | null;
  beneficiaire_date_naissance?: string | null; beneficiaire_lien?: string | null; beneficiaire_email?: string | null;
};

/** âge en années entières à la date « ref » (aujourd'hui par défaut) ; null si date absente ou invalide */
export function ageAu(naissance: string | null | undefined, ref: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(naissance || ''); if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  let a = ref.getFullYear() - y;
  if (ref.getMonth() + 1 < mo || (ref.getMonth() + 1 === mo && ref.getDate() < d)) a--;
  return a >= 0 && a < 130 ? a : null;
}
/** mineur : moins de 18 ans (date de naissance inconnue : false) */
export const estMineur = (naissance: string | null | undefined, ref?: Date): boolean => { const a = ageAu(naissance, ref); return a !== null && a < 18; };

export const nomBenef = (b: Benef): string => [b.beneficiaire_prenom, b.beneficiaire_nom].filter(Boolean).join(' ');

/** « né(e) le 12/03/2016 » : format fixe jj/mm/aaaa, sans réglage régional (pas de risque d'hydratation) */
export function dateFr(iso: string | null | undefined): string { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; }

/** résumé d'une ligne : « Léa Dupont, née le 12/03/2016 (9 ans) · Parent » */
export function resumeBenef(b: Benef, ref?: Date): string {
  const n = nomBenef(b); const a = ageAu(b.beneficiaire_date_naissance, ref);
  return [n || 'bénéficiaire non précisé', b.beneficiaire_date_naissance ? `né(e) le ${dateFr(b.beneficiaire_date_naissance)}${a !== null ? ` (${a} an${a > 1 ? 's' : ''})` : ''}` : '', b.beneficiaire_lien || ''].filter(Boolean).join(' · ');
}
