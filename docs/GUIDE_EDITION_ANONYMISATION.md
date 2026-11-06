# Édition d'une fiche coopérateur et anonymisation

## 1. Modifier une fiche (Registre des Coopérateurs)
- Bouton **✏ Modifier** sur chaque ligne du registre et dans la fiche (visible avec le droit d'écriture sur « Coopérateurs »).
- Champs : nom / raison sociale, prénom, représentant, registre national / BCE, e-mail, téléphone, rue, n°, code postal, ville, pays, métier, compétences, accord de contact téléphonique, parts offertes (bénéficiaire : nom, prénom, naissance, lien, e-mail).
- **Non modifiables** : nombre de parts, capital, n° de certificat, mouvements (onglet « Mouvements & Parts »). La fonction SQL refuse tout autre champ.
- Seuls les champs modifiés sont envoyés. Validations côté base : nom obligatoire, e-mail valide, numéro à 10 ou 11 chiffres et unique, date de naissance plausible.
- **Audit** : une seule entrée « Modification de la fiche » dans `public.journal` (table réelle du projet ; il n'existe pas de `journal_audit_cooperateurs`) avec champs modifiés, ancienne et nouvelle valeur, auteur, date. Visible dans l'onglet « Journal / Audit ».
- L'annuaire des compétences reste alimenté uniquement par le formulaire Google (accord « Oui ») : une édition manuelle n'y ajoute personne.

## 2. Mode Démo / Présentation (réversible, aucune écriture en base)
- Bouton « 🕶 Démo » en haut de page ou case dans « ⚙ Paramètres » (administrateurs). Préférence mémorisée dans le navigateur.
- Masque noms, e-mails, téléphones, numéros, rues, métiers, bénéficiaires et détails du journal (ex. `J*** D***`, `j****@badjawe.be`). Montants, parts, certificats et communes restent visibles. Application en lecture seule ; export non anonymisé et certificats PDF désactivés.

## 3. Anonymisation définitive (irréversible, administrateurs)
- « ⚙ Paramètres » → périmètre **A** (coopérateurs : fiches, contacts, adresses) ou **B** (coopérateurs + demandes de souscription) ; option « conserver code postal et commune ».
- Confirmation renforcée : case à cocher + saisie du mot **ANONYMISER**, contrôle d'administrateur refait dans la base (`anonymiser_donnees()`).
- Conservés : montants, parts, certificats, mouvements (contrôle d'intégrité, annulation de l'opération si les totaux changent). Le journal est nettoyé des données personnelles et une entrée « Anonymisation irréversible » est ajoutée.
- **Hors périmètre** : Google Sheet de réponses, Odoo, Brevo, PDF déjà envoyés et sauvegardes Supabase gardent les données d'origine. Faire une sauvegarde avant.
- Test recommandé : sur une copie (projet Supabase de test) avant la production.
