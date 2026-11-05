# Google Form : questions « compétences et talents » (à ajouter au formulaire de souscription)

## 1. Intitulés exacts à utiliser dans le formulaire

L'import reconnaît les colonnes par leur intitulé (insensible aux accents et aux majuscules). Copiez-collez ces trois intitulés tels quels :

| # | Intitulé de la question (= en-tête de colonne du Sheet) | Type de question Google Forms | Obligatoire ? | Colonne en base |
|---|---|---|---|---|
| 1 | `Métier / Profession` | Réponse courte | Non | `profession` |
| 2 | `Compétences, talents et savoir-faire que vous souhaitez mettre au service de la coopérative` | Paragraphe (texte long) | Non | `competences` |
| 3 | `Acceptez-vous d’être contacté(e) par téléphone en cas de besoin de vos compétences pour la coopérative ?` | Choix multiples, deux options : `Oui` et `Non` | Non (ne rien présélectionner) | `accord_contact_tel` |

Conseils de saisie pour les coopérateurs (à mettre dans la description de la question 2) : « Séparez vos compétences par des virgules, par exemple : comptabilité, menuiserie, communication, événementiel, électricité, droit ». Le séparateur sert à créer les étiquettes de filtre de l'annuaire (virgule, point-virgule, retour à la ligne, « / » ou « et »).

## 2. Règles de reconnaissance (pour ne pas casser l'import)

- Question 3 : l'intitulé doit contenir un verbe d'accord (**accept…**, **accord**, **autoris…**, **être contacté**) **et** le mot **téléphone** (ou « appel », « GSM », « mobile »). Les cases comme « J'accepte les statuts » ou « J'accepte la newsletter » ne sont jamais prises pour l'accord téléphonique.
- Question 1 : l'intitulé doit contenir **métier** ou **profession**. Question 2 : **compétence**, **talent**, **savoir-faire** ou **mettre au service**.
- Ne renommez pas la colonne « Téléphone » existante en y ajoutant ces mots : la colonne du numéro de téléphone doit continuer à s'appeler « Téléphone » (ou « GSM »).
- Seule la réponse **« Oui »** (ou « Yes », « Ja ») vaut accord. « Non » est enregistré comme refus ; une réponse vide ou ambiguë (« peut-être ») est traitée comme **non renseignée**, donc **sans accord**.

## 3. Ce que fait l'application

1. **Import** (« Synchroniser » dans Souscriptions & Demandes, ou `POST /api/cooperateurs/google-sheet`) : les 3 réponses sont enregistrées sur la demande. Une ligne déjà importée n'est jamais écrasée ; ses champs de profil encore vides sont simplement complétés tant qu'elle n'est pas validée.
2. **Validation dans le registre** : le profil est recopié sur la fiche du coopérateur (colonnes de `cooperateurs`). Si la personne souscrit à nouveau, **la réponse la plus récente fait foi** : un « Non » la retire de l'annuaire, un « Oui » l'y remet.
3. **Annuaire** (onglet « Statistiques, AG & Valorisation ») : une fiche n'apparaît que si son profil vient du formulaire (`profil_source = 'google_form'`), avec un métier ou des compétences, **accord « Oui »**, et si la personne détient encore des parts. La même règle est appliquée par la vue SQL `v_annuaire_competences`.
4. **Export CSV** : la liste filtrée à l'écran (séparateur « ; », UTF-8 avec BOM, s'ouvre dans Excel). Fichier à usage interne : il contient des coordonnées de personnes ayant donné leur accord ; ne le diffusez pas en dehors de l'organisation des chantiers ou groupes de travail.

## 4. Mise en place pas à pas

1. Google Forms : ajouter les 3 questions ci-dessus (la liaison au Sheet crée automatiquement les 3 colonnes).
2. Supabase (SQL Editor) : exécuter `sql/13_cooperateurs_competences.sql` (rejouable). Le script reprend aussi, si elles existent, les réponses déjà stockées dans `donnees_brutes` pour les coopérateurs déjà validés.
3. Déployer sur Vercel (aucune variable d'environnement nouvelle), recharger l'application.
4. Dans l'application : « Synchroniser » puis valider les nouvelles souscriptions ; l'annuaire se remplit au fur et à mesure.

Limite à connaître : les coopérateurs validés **avant** l'ajout des questions n'ont pas de profil (ils n'ont jamais répondu). Ils n'apparaîtront qu'après une nouvelle souscription ou une réponse enregistrée. Les réponses ajoutées à la main dans le Sheet sur d'anciennes lignes déjà **validées** ne sont pas reprises (ligne verrouillée).
