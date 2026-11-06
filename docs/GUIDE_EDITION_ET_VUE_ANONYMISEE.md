# Édition d'une fiche et rôle « Vue coopérateurs anonymisée »

**Aucune anonymisation ni purge en base.** Le projet ne contient plus aucune fonction, route ou bouton qui écrase ou supprime des données de coopérateurs (`sql/15` supprime d'ailleurs les anciennes fonctions `anonymiser_donnees()` / `apercu_anonymisation()` si elles avaient été créées).

## 1. Modifier une fiche (gestionnaires)
- Bouton **✏ Modifier** (ligne du Registre et fiche) pour les rôles « Modification complète ». Champs : identité, registre national / BCE, e-mail, téléphone, adresse, métier, compétences, accord de contact téléphonique, bénéficiaire d'un cadeau.
- **Non modifiables** : parts, capital, n° de certificat, mouvements (la base refuse ces champs).
- Audit : une entrée « Modification de la fiche » dans `public.journal` (champs modifiés, ancienne et nouvelle valeur, auteur, date), visible dans « Journal / Audit ».

## 2. Niveaux d'accès au module Coopérateurs
| Rôle / niveau | Données | Édition | Exports | Journal, doublons, paramètres |
|---|---|---|---|---|
| Administrateur / **Modification complète** | en clair | oui | complets | oui (paramètres : admin seulement) |
| **Lecture seule** | en clair | non | selon droits | selon droits |
| **Vue anonymisée** (rôle `coop_anonyme`) | **toujours masquées** | non | export anonymisé uniquement | non |

## 3. Comment fonctionne la « Vue anonymisée » (masquage forcé)
- Le masquage est fait **par la base** (`coop_vue_anonymisee()`, `sql/16`) : le rôle n'a aucun droit de lecture sur les tables brutes (RLS) et ne reçoit que des données déjà masquées (`J*** D***`, `j****@badjawe.be`, `04XX/******`, `XX.XX.XX-XXX.XX`, rues `•••••`, métiers/compétences/remarques `••••••`, références de virement sans nom). Il n'existe donc aucun bouton, ni astuce navigateur, pour lever le masquage.
- Restent lisibles : montants, parts, totaux, dates de mouvements, n° de certificats, classes, communes et codes postaux, statistiques et valorisations.
- Les routes du module (exports, certificats PDF, Google Sheet, Odoo, Brevo…) refusent ce profil. Onglets visibles : Souscriptions & Demandes (masquées), Registre, Mouvements, Statistiques. Pas d'annuaire des compétences, de feuille d'émargement nominative, de doublons, de journal ni de paramètres.
- Écritures impossibles : RLS et fonctions SQL (`coop_exiger_ecriture()`) refusent ce profil.

## 4. Affecter le rôle
1. Exécuter `sql/16` (crée le rôle « Vue coopérateurs anonymisée »).
2. Coopérateurs > **⚙ Paramètres** : choisir le rôle de chaque utilisateur et, si besoin, le niveau d'un rôle (Aucun / Vue anonymisée / Lecture / Modification). Les mêmes réglages existent dans Admin > Rôles (case « Vue anonymisée ») et Admin > Utilisateurs.
3. Un administrateur n'est jamais soumis à la vue anonymisée.

## 5. Mode Démo (projection en réunion)
Bouton « 🕶 Démo » (administrateurs) : masque l'écran de l'administrateur, lecture seule, **temporaire** (désactivé au rechargement), aucun effet en base. Ce n'est qu'un confort d'affichage, pas une protection : pour un tiers, utiliser le rôle « Vue anonymisée ».

## Limites à connaître
- Le masquage ne cache pas les valeurs qui permettent de recouper une personne par ses chiffres (ex. une seule personne détenant 40 parts dans une petite commune) ; commune et code postal restent visibles.
- Le journal d'audit n'est pas accessible à ce profil.
