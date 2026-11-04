// lib/cooperateurs/types.ts : types partagés du module Coopérateurs
export type Demande = {
  id: string; google_row_id: string | null; date_demande: string; nom: string; prenom: string | null; representant: string | null;
  email: string | null; telephone: string | null; rue: string | null; numero: string | null; code_postal: string | null; ville: string | null; pays: string | null;
  numero_national: string | null; numero_valide: boolean | null; reference_bancaire: string | null;
  type_souscripteur: 'personne_physique' | 'entreprise'; categorie_code: 'B' | 'C' | 'D'; nombre_parts: number; montant_total: number | null;
  is_existing_coop: boolean; existing_coop_id: number | null;
  odoo_sign_request_id: string | null; odoo_sign_status: 'a_envoyer' | 'envoye' | 'signe'; date_dernier_rappel: string | null;
  paiement_confirme: boolean; date_paiement: string | null; valide_registre: boolean; cooperateur_id: number | null; certificat_numero: number | null; certificat_genere: boolean;
  odoo_mailing_synced: boolean; brevo_synced: boolean; is_locked: boolean; donnees_brutes: any;
};
export type Mouvement = { id: number; cooperateur_id: number; date_mouvement: string | null; nombre_parts: number; montant_total: number | null; demande_id: string | null };
export type Adresse = { id: number; cooperateur_id: number; type: string; rue: string | null; numero: string | null; code_postal: string | null; ville: string | null; pays: string | null };
export type Contact = { id: number; cooperateur_id: number; type: 'email' | 'telephone'; valeur: string; principal: boolean };
export type Categorie = { id: number; code: 'A' | 'B' | 'C' | 'D'; libelle: string; description: string | null };
export type Cooperateur = {
  id: number; certificat: number | null; nom: string; prenom: string | null; representant: string | null; numero_identification: string | null;
  categorie_id: number | null; remarques: string | null; created_at: string;
  categories?: { code: string; libelle: string } | null; adresses?: Adresse[]; contacts?: Contact[]; mouvements_parts?: Mouvement[];
};
export type Valorisation = {
  id: number; date_cloture: string; nombre_parts: number; valeur_nominale: number; capital: number; capital_non_libere: number; reserves: number;
  resultat_reporte: number; resultat_exercice: number; subsides_capital: number; capitaux_propres: number; valeur_comptable_part: number; remarque: string | null; calcule_le: string;
};
export type JournalRow = { id: number; horodatage: string; utilisateur: string | null; action: string | null; operation: string; table_nom: string | null; cooperateur_id: number | null; libelle: string | null };
export type ConnectorResult = { ok: boolean; simulation?: boolean; message: string; [k: string]: any };
