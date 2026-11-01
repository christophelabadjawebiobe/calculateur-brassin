// lib/defaults-data.ts : données de référence tirées des grands livres 2024-2026 (Odoo) et des ventes par secteur 2025-2026.
// Fichier généré à partir des exports ; les valeurs servent de défaut aux assistants du Budget et restent modifiables à l'écran.

/** Chiffre d'affaires mensuel (comptes 70xxxx), janv. → déc. ; 2026 : janv. → oct. */
export const CA_MONTHLY: Record<number, number[]> = { 2024: [14917,30153,36372,40140,40680,51726,19491,41942,42352,36901,45536,26466], 2025: [18651,9434,25855,29001,53425,41490,37044,35546,38394,26545,41973,39043], 2026: [15346,15496,26414,30131,45739,64426,26772,18486,36611,23360,0,0] };

/** Classe 60 (section « Approvisionnements ») rapportée au CA (comptes 70xxxx) ; 2026 = janv.–oct. */
export const RATIOS_60: { year: number; ca: number; s60: number; pct: number; partial?: boolean }[] = [
  { year: 2024, ca: 426676, s60: 161849, pct: 37.93 },
  { year: 2025, ca: 396402, s60: 119966, pct: 30.26 },
  { year: 2026, ca: 302781, s60: 91136, pct: 30.1, partial: true }
];

/** Poids des comptes d'achats (hors variations de stock 609xxx et 710xxx) : 2025 + janv.–oct. 2026 */
export const S60_SHARES: [string, number][] = [["600000", 0.292], ["600005", 0.2317], ["600010", 0.1393], ["600004", 0.0576], ["600008", 0.042], ["600006", 0.0362], ["603020", 0.0344], ["604000", 0.0275], ["615220", 0.0274], ["600015", 0.0219], ["613050", 0.0217], ["600007", 0.0196], ["602000", 0.0189], ["600016", 0.0138], ["603030", 0.0054], ["613055", 0.0035], ["604005", 0.0021], ["613000", 0.0017], ["605000", 0.0013], ["601700", 0.0011], ["601000", 0.0004], ["603000", 0.0004], ["600009", 0.0001]];

/** Charges récurrentes (classes 61 et énergie) : montant mensuel typique d'après le grand livre 2026 */
export type Fixed61 = { code: string; cat: string; name: string; monthly: number; basis: string; rec: boolean; y2025: number; y2026: number };
export const FIXED_61: Fixed61[] = [
  {code: "611100", cat: "Loyer", name: "Loyers bâtiment à Alleur", monthly: 1819, y2025: 22638, y2026: 18128, basis: "médiane avr.–oct. 2026", rec: true},
  {code: "611120", cat: "Loyer", name: "Charges bâtiment Alleur", monthly: 200, y2025: 2400, y2026: 2000, basis: "médiane avr.–oct. 2026", rec: true},
  {code: "612110", cat: "Énergie", name: "Gaz", monthly: 385, y2025: 3532, y2026: 2014, basis: "médiane avr.–oct. 2026", rec: true},
  {code: "612120", cat: "Énergie", name: "Electricité", monthly: 661, y2025: 8341, y2026: 5777, basis: "médiane avr.–oct. 2026", rec: true},
  {code: "613500", cat: "Assurances", name: "Assurance incendie et frais généraux", monthly: 232, y2025: 2569, y2026: 2321, basis: "moyenne janv.–oct. 2026", rec: true},
  {code: "613530", cat: "Assurances", name: "Assurance responsabilité civile", monthly: 34, y2025: 916, y2026: 1874, basis: "médiane avr.–oct. 2026", rec: true},
  {code: "614003", cat: "Assurances", name: "Assurances véhicules", monthly: 252, y2025: 1333, y2026: 2374, basis: "médiane avr.–oct. 2026", rec: true},
  {code: "613510", cat: "Assurances", name: "Assurance contre le vol", monthly: 0, y2025: 0, y2026: 0, basis: "moyenne janv.–oct. 2026", rec: false},
  {code: "612510", cat: "Abonnements", name: "GSM", monthly: 84, y2025: 321, y2026: 752, basis: "médiane avr.–oct. 2026", rec: true},
  {code: "612520", cat: "Abonnements", name: "Internet, site, hébergement, mail box", monthly: 11, y2025: 568, y2026: 146, basis: "médiane avr.–oct. 2026", rec: true},
  {code: "612530", cat: "Abonnements", name: "Licences informatiques", monthly: 224, y2025: 2046, y2026: 2574, basis: "médiane avr.–oct. 2026", rec: true},
  {code: "612500", cat: "Abonnements", name: "Téléphone", monthly: 0, y2025: 0, y2026: 0, basis: "moyenne janv.–oct. 2026", rec: false},
  {code: "611520", cat: "Maintenance", name: "Entretien et rép. - matériel", monthly: 99, y2025: 4194, y2026: 4259, basis: "médiane avr.–oct. 2026", rec: true},
  {code: "611410", cat: "Maintenance", name: "Entretien et rép. - Constructions", monthly: 120, y2025: 1308, y2026: 1196, basis: "moyenne janv.–oct. 2026", rec: true},
  {code: "611000", cat: "Maintenance", name: "Entretien et réparation", monthly: 0, y2025: 0, y2026: 0, basis: "moyenne janv.–oct. 2026", rec: false},
  {code: "611200", cat: "Maintenance", name: "Prestations de nettoyage", monthly: 99, y2025: 516, y2026: 989, basis: "moyenne janv.–oct. 2026", rec: true},
  {code: "613250", cat: "Autres récurrents", name: "Prestations (aide-)comptable", monthly: 1072, y2025: 11677, y2026: 9785, basis: "médiane avr.–oct. 2026", rec: true},
  {code: "613310", cat: "Autres récurrents", name: "Certification bio", monthly: 85, y2025: 1775, y2026: 2135, basis: "médiane avr.–oct. 2026", rec: true},
  {code: "615420", cat: "Autres récurrents", name: "Cotisations groupement professionnels", monthly: 24, y2025: 669, y2026: 617, basis: "médiane avr.–oct. 2026", rec: true},
  {code: "613260", cat: "Autres récurrents", name: "Expert-comptable", monthly: 99, y2025: 1076, y2026: 994, basis: "moyenne janv.–oct. 2026", rec: false},
  {code: "614004", cat: "Autres récurrents", name: "Carburant", monthly: 377, y2025: 2199, y2026: 2693, basis: "médiane avr.–oct. 2026", rec: true}
];
