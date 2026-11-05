# Formulaire de souscription : parts offertes (cadeau / mineur), compétences et consentements RGPD

Fichiers : `docs/formulaire-souscription.gs` (création du formulaire), `sql/14_cooperateurs_cadeau_rgpd.sql` (base), `lib/cooperateurs/sheet.ts` (import), onglets « Souscriptions & Demandes » et « Registre ».

## 1. Créer le formulaire
1. https://script.google.com → Nouveau projet → coller `formulaire-souscription.gs` → Enregistrer (Ctrl+S). Fermer toute fenêtre « Nouveau déploiement » : elle n'est pas nécessaire.
2. Choisir la fonction `creerFormulaireSouscription` → Exécuter → autoriser l'accès (Forms, Sheets).
3. Le Journal d'exécution affiche le lien du formulaire (modifier / diffuser), le lien du Sheet et son identifiant.
4. Vercel → Settings → Environment Variables : `GOOGLE_SHEET_ID` = identifiant du nouveau Sheet, partagé en lecture avec le compte de service Google (voir `docs/GUIDE_ACTIVATION_CONNECTEURS.md`). Si le nom de l'onglet n'est pas le premier : `GOOGLE_SHEET_NAME`. Redéployer.

Si vous aviez déjà un formulaire en service, les anciennes lignes restent dans l'ancien Sheet : importez-les d'abord (« Synchroniser »), puis changez `GOOGLE_SHEET_ID`. Les lignes déjà importées ne sont jamais écrasées.

## 2. Questions et colonnes (intitulés exacts, à ne pas renommer)

| Page | Intitulé de la question | Réponses | Enregistré dans |
|---|---|---|---|
| 1 | Cette souscription est effectuée : | Pour moi-même / Comme cadeau / pour un mineur | `est_cadeau` |
| 1 | Vous souscrivez en qualité de : | Particulier (Parts B) / Entreprise / Indépendant (Parts D) / Institution (Parts C) | classe B / D / C |
| 1 | Nombre de parts souhaité : | entier ≥ 1 | `nombre_parts` |
| 2 (cadeau seulement) | Nom du bénéficiaire, Prénom du bénéficiaire | texte | `beneficiaire_nom`, `beneficiaire_prenom` |
| 2 | Date de naissance du bénéficiaire | date | `beneficiaire_date_naissance` |
| 2 | Lien de parenté / Représentation légale | Parent, Grand-parent, Parrain/Marraine, Proche | `beneficiaire_lien` |
| 2 | Email de contact du bénéficiaire (facultatif) | e-mail | `beneficiaire_email` |
| 3 | Nom du souscripteur, Prénom du souscripteur | texte | `nom`, `prenom` |
| 3 | Email du souscripteur | e-mail | `email` |
| 3 | Téléphone | texte | `telephone` |
| 3 | Dénomination sociale (entreprise / institution) | facultatif | `nom` de la fiche (le souscripteur devient le représentant) |
| 3 | Numéro d'entreprise / BCE, Registre National | facultatifs | `numero_national` |
| 3 | Rue et numéro, Code postal, Ville, Pays | texte | adresse |
| 4 | Métier / Profession | texte | `profession` |
| 4 | Compétences, talents et savoir-faire que vous souhaitez mettre au service de la coopérative | paragraphe | `competences` |
| 5 | Acceptez-vous d'être contacté(e) par téléphone en cas de besoin de vos compétences pour la coopérative ? | Oui / Non | `accord_contact_tel` |
| 5 | Information et vie de la coopérative (Newsletter) | « Oui, j'accepte de recevoir les actualités et la newsletter de La Badjawe par e-mail » / Non | `consentement_newsletter` |
| 5 | Adhésion aux statuts et traitement des données | case obligatoire | (preuve dans `donnees_brutes`) |

Déroulé : « Pour moi-même » saute la page 2 (bénéficiaire) ; « Comme cadeau / pour un mineur » l'affiche. L'import reconnaît les colonnes par mots-clés : gardez « bénéficiaire », « newsletter » / « actualités », « téléphone » + « accept », « métier », « compétences ».
Seul un « Oui » explicite vaut consentement ; « Non », vide ou ambigu : pas de consentement.

## 3. Base de données (Supabase)
Exécuter `sql/14_cooperateurs_cadeau_rgpd.sql` (après 07, 11 et 13 ; rejouable). Les tables s'appellent `cooperateur_demandes` et `cooperateurs`.
- Colonnes ajoutées sur les deux tables : `est_cadeau`, `beneficiaire_*`, `consentement_newsletter` ; sur `cooperateur_demandes` aussi `newsletter_repondu` (distingue « Non » d'une question absente).
- `importer_demandes()` enregistre ces champs ; `valider_demande()` les recopie sur la fiche.
- Vue `v_newsletter_abonnes` : uniquement les coopérateurs ayant consenti et ayant un e-mail.

## 4. Règles de gestion
- **Fiche = souscripteur** (celui qui paie, responsable légal pour un mineur) : numéro de certificat, coordonnées et e-mail sont les siens. Le bénéficiaire est décrit sur la fiche et sur la demande.
- **Plusieurs cadeaux** : `est_cadeau` reste vrai ; les champs bénéficiaire de la fiche montrent le dernier cadeau. La fiche (onglet Registre) liste tous les cadeaux à partir des demandes.
- **Mineur** : calculé à l'affichage d'après la date de naissance (moins de 18 ans aujourd'hui) ; le badge disparaît tout seul à la majorité.
- **Newsletter** : Odoo (liste de diffusion) et Brevo ne reçoivent le contact que si le consentement est « Oui ». La réponse la plus récente fait foi : un « Non » lors d'une nouvelle souscription retire le consentement dans la base (sans réponse, la fiche est inchangée). Le certificat par e-mail (message transactionnel) n'est pas une newsletter et n'est pas concerné.
- Les lignes déjà validées (verrouillées) ne sont jamais modifiées par l'import.
