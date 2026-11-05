# Guide d'activation des connecteurs : Google Sheet, Odoo, Brevo

Tant qu'une variable obligatoire manque, le connecteur concerné reste en **mode simulation** (aucun appel externe, identifiants fictifs `SIM-…`). On peut donc activer les services un par un.
Après chaque activation : **Redéployer** sur Vercel, puis cliquer sur **🩺 Tester les connecteurs** (onglet « Souscriptions & Demandes », visible des administrateurs). Ce test vérifie pas à pas l'authentification, les identifiants et les colonnes, **sans rien créer ni modifier** chez Google, Odoo ou Brevo, et affiche les numéros à copier (modèles Odoo, listes Brevo…).

Ordre conseillé : Brevo (le plus simple) → Google Sheet → Odoo.

## 0. Renseigner une variable dans Vercel
1. vercel.com → votre projet → **Settings** → **Environment Variables**.
2. **Key** = le nom de la variable (exactement, majuscules), **Value** = la valeur, cocher **Production** (et **Preview** si vous testez des branches), **Save**. Pour les secrets, activer l'option « Sensitive » si Vercel la propose.
3. **Les variables ne s'appliquent qu'aux nouveaux déploiements** : onglet **Deployments** → dernier déploiement → menu **⋯** → **Redeploy**.
4. Ne jamais préfixer ces variables par `NEXT_PUBLIC_` (elles seraient exposées dans le navigateur). Ne jamais les coller dans le code ou dans un fichier du dépôt.
5. En local : les mettre dans `.env.local` (non versionné).

| Variable | Service | Obligatoire pour activer | Rôle |
|---|---|---|---|
| `GOOGLE_SHEET_ID` | Google | oui | identifiant de la feuille |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google | recommandé | contenu complet du fichier JSON du compte de service |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` | Google | alternative au JSON | e-mail du compte de service + clé privée |
| `GOOGLE_API_KEY` | Google | alternative (feuille partagée par lien) | clé API Google |
| `GOOGLE_SHEET_NAME` | Google | non | nom de l'onglet (par défaut : le premier) |
| `GOOGLE_SHEET_GID` | Google | non | n° d'onglet pour l'export CSV public (par défaut 0) |
| `ODOO_URL` | Odoo | oui | ex. `https://labadjawe.odoo.com` (sans `/` final ni `/odoo`) |
| `ODOO_API_KEY` | Odoo | oui | clé API de l'utilisateur Odoo |
| `ODOO_USER` | Odoo | oui | identifiant (e-mail de connexion) de cet utilisateur |
| `ODOO_DB` | Odoo | recommandé | nom de la base (Odoo Online : le sous-domaine, ex. `labadjawe`) |
| `ODOO_SIGN_TEMPLATE_ID` | Odoo Sign | recommandé | n° du modèle « Bulletin de souscription » |
| `ODOO_SIGN_ROLE_ID` | Odoo Sign | non | n° du rôle du signataire (sinon lu dans le modèle) |
| `ODOO_SIGN_SEND_METHOD` | Odoo Sign | non | méthode publique d'envoi de `sign.request` si la détection automatique échoue (jamais de méthode préfixée `_`) |
| `ODOO_MAILING_LIST_NAME` | Odoo | non | nom de la liste (par défaut « Coopérateurs ») |
| `BREVO_API_KEY` | Brevo | oui | clé API v3 |
| `BREVO_LIST_ID` | Brevo | recommandé | n° de la liste « Coopérateurs » |
| `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` | Brevo | pour l'envoi des certificats par e-mail | expéditeur validé dans Brevo |

---
## A. Google Form → Google Sheet

### A1. Lier le formulaire à une feuille
Google Forms → onglet **Réponses** → **Lier à Sheets** (ou « Créer une feuille de calcul »). L'identifiant de la feuille est dans son adresse :
`https://docs.google.com/spreadsheets/d/`**`1AbC…xyz`**`/edit` → `GOOGLE_SHEET_ID=1AbC…xyz`.
Si la feuille contient plusieurs onglets et que les réponses ne sont pas dans le premier, renseignez `GOOGLE_SHEET_NAME` (ex. `Réponses au formulaire 1`).

### A2. Autoriser la lecture : compte de service (recommandé)
La feuille contient des données personnelles (numéros nationaux) : **ne la rendez pas publique**. Un *compte de service* est un « robot » Google qui lit la feuille privée partagée avec lui.
1. console.cloud.google.com → créer (ou choisir) un projet.
2. **API et services** → **Bibliothèque** → « Google Sheets API » → **Activer**.
3. **IAM et administration** → **Comptes de service** → **Créer un compte de service** (nom libre, ex. `badjawe-registre`) ; aucun rôle n'est nécessaire.
4. Ouvrir le compte → onglet **Clés** → **Ajouter une clé** → **Créer une clé** → **JSON** : un fichier est téléchargé (le conserver en lieu sûr, ne pas le publier).
5. Dans ce fichier, repérer `client_email` (du type `badjawe-registre@projet.iam.gserviceaccount.com`).
6. Ouvrir la feuille Google → **Partager** → coller cet e-mail → rôle **Lecteur** → décocher « Prévenir les personnes » → **Partager**.
7. Dans Vercel : `GOOGLE_SHEET_ID` + `GOOGLE_SERVICE_ACCOUNT_JSON` = **tout le contenu** du fichier JSON (copier-coller intégral). Variante : `GOOGLE_SERVICE_ACCOUNT_EMAIL` = le `client_email` et `GOOGLE_PRIVATE_KEY` = la valeur de `private_key` (les `\n` littéraux sont acceptés).
8. Redéployer, puis **🩺 Tester les connecteurs**.

*Remarque :* certaines organisations Google Workspace bloquent la création de clés de compte de service (règle d'administration) ; dans ce cas, demandez à l'administrateur de l'autoriser, ou utilisez A3.

### A3. Alternatives (moins sûres)
- **Clé API + feuille « Toute personne disposant du lien : Lecteur »** : `GOOGLE_SHEET_ID` + `GOOGLE_API_KEY` (Cloud Console → Identifiants → Créer une clé API, restreinte à Google Sheets API). Toute personne ayant le lien peut lire les données.
- **Rien d'autre que `GOOGLE_SHEET_ID`** avec la feuille partagée par lien : l'application lit l'export CSV public.
- **Webhook Apps Script** (la feuille pousse les lignes vers le portail) : non fourni ; le compte de service est plus simple et ne demande aucun script.

### A4. Intitulés de colonnes attendus
Le nom exact des questions n'a **pas** besoin d'être identique : l'application reconnaît les mots-clés (accents et majuscules ignorés). Intitulés recommandés (testés) :

| Question du formulaire | Champ | Obligatoire |
|---|---|---|
| Horodateur *(automatique)* | date de la demande | non (sinon : date d'import) |
| Adresse e-mail | e-mail | **oui** |
| Vous souscrivez en tant que *(Personne physique / Entreprise / Institution)* | type et classe | non |
| Nom *(ou dénomination sociale)* | nom | **oui** |
| Prénom | prénom | non (personnes physiques) |
| Représentant légal *(si entreprise ou institution)* | représentant | non |
| Numéro national *(personne physique)* et/ou Numéro d'entreprise BCE | n° d'identification | non (vérifié modulo 97) |
| Téléphone / GSM | téléphone | non |
| Rue · Numéro · Code postal · Commune · Pays | adresse | non |
| Nombre de parts souhaité | parts | **oui** (sinon 1) |
| Classe de parts *(facultatif : lettre B, C ou D)* | classe forcée | non |

Règles utiles :
- On peut avoir **deux colonnes** de numéro (un « Numéro national » et un « Numéro d'entreprise BCE ») : la première valeur non vide est retenue. Idem pour plusieurs colonnes téléphone ou e-mail.
- Évitez dans un **intitulé** les mots *entreprise*, *statut* ou *type* pour une question qui n'est pas le type de souscripteur (ils déclenchent la reconnaissance du champ « type »). Exemple : la case « J'ai pris connaissance des statuts » est ignorée sans problème.
- Classes : *Personne physique* → **B** ; mention *institution, commune, CPAS, pouvoir public, fonds, fondation…* → **C (Institutionnel)** ; autres personnes morales (*entreprise, société, ASBL…*) → **D (Entreprise)**. Une lettre explicite dans « Classe de parts » prime. La classe A (garant) n'est jamais issue du formulaire.
- La référence de virement est générée : `LDF2026 : NOM Prénom` (entreprise : `LDF2026 : NOM`). Le préfixe `LDF` se règle dans la table `parametres` (`prefixe_reference`).
- Dates acceptées : `31/10/2026 14:05:12` (format Google Sheets) ou `2026-10-31 14:05`.
- **Une ligne déjà importée n'est jamais écrasée** : l'identifiant d'une réponse est calculé à partir de la date, de l'e-mail et du nom. Corriger une réponse *dans le Sheet* après import ne modifie donc pas la demande ; corrigez-la dans le portail (tant qu'elle n'est pas validée). Si vous changez l'e-mail ou le nom dans le Sheet, la ligne sera importée comme une nouvelle demande.
- Le bouton **🩺 Tester les connecteurs** affiche les colonnes reconnues, celles qui manquent et les en-têtes ignorés.

---
## B. Odoo (Odoo Sign + liste de diffusion)

### B1. Un utilisateur et une clé API dédiés
1. Odoo → **Paramètres → Utilisateurs** → créer un utilisateur « Portail Badjawe » (e-mail de connexion, ex. `portail@labadjawe.be`) avec les droits **Sign : Administrateur** (ou Utilisateur avec accès aux modèles) et **Marketing par e-mail : Utilisateur/Administrateur**, ainsi que l'accès aux Contacts.
2. Se connecter avec cet utilisateur → menu du profil → **Préférences** (« Mon profil ») → onglet **Sécurité du compte** → **Nouvelle clé API** → description « Portail coopérateurs » → copier la clé affichée (**elle ne sera plus visible**).
3. Variables : `ODOO_URL` (adresse de l'instance, ex. `https://labadjawe.odoo.com`), `ODOO_USER` (e-mail de l'utilisateur), `ODOO_API_KEY` (la clé), `ODOO_DB` (Odoo Online : la partie avant `.odoo.com` ; auto-hébergé : le nom de la base).

### B2. Le modèle de signature (`sign.template`)
1. Application **Sign** → **Modèles** → importer le PDF du bulletin de souscription, placer les champs (signature, date, nom…) et affecter-les à **un seul rôle** de signataire (ex. « Coopérateur »).
2. Le numéro du modèle : il apparaît dans l'adresse de la page du modèle (`…/sign.template/12`, `#id=12` ou `/action-xxx/12` selon la version) ; le plus simple est de lancer **🩺 Tester les connecteurs** : tant que `ODOO_SIGN_TEMPLATE_ID` est vide, le test liste les modèles (« 12 = Bulletin de souscription »).
3. Renseigner `ODOO_SIGN_TEMPLATE_ID=12`. Facultatif : `ODOO_SIGN_ROLE_ID` (le test liste aussi les rôles ; sinon il est lu dans le modèle).
4. À l'envoi, l'application crée la demande de signature pour le souscripteur (contact créé dans Odoo s'il n'existe pas, recherché par e-mail). Le bouton **Relancer** renvoie le lien ; **✍ Actualiser les signatures** interroge Odoo et passe en « Signé » les bulletins signés (il n'y a pas de webhook : l'actualisation se fait à la demande).

### B3. La liste de diffusion « Coopérateurs » (`mailing.list`)
1. Installer l'application **Marketing par e-mail** si ce n'est pas fait, puis **Listes de diffusion** → créer « Coopérateurs » (nom exact, ou autre nom + `ODOO_MAILING_LIST_NAME`).
2. À chaque « Valider dans le registre », le contact (`mailing.contact`) est créé ou mis à jour et rattaché à cette liste. Si la liste n'existe pas, elle est créée automatiquement. Le test affiche les listes existantes.

### B4. À savoir (important)
- L'application parle à Odoo en **JSON-RPC** (`/jsonrpc`). Les noms de méthodes d'Odoo Sign (`sign.request.initialize_new`, `send_signature_accesses`…) **varient selon la version d'Odoo** et je n'ai pas pu les essayer sur votre instance : **faites un premier envoi réel à votre propre adresse** avant l'envoi aux coopérateurs. En cas d'erreur, le message exact d'Odoo est affiché dans l'application (envoyez-le-moi pour ajuster).
- Les interfaces RPC historiques d'Odoo (XML-RPC / JSON-RPC) sont annoncées comme dépréciées au profit de la nouvelle API externe dans les versions récentes : vérifiez la documentation de votre version si vous migrez.

---
## C. Brevo (ex-Sendinblue)

1. Brevo → menu du compte (en haut à droite) → **SMTP & API** → onglet **Clés API** → **Générer une nouvelle clé API** (nom « Portail coopérateurs ») → copier la clé → `BREVO_API_KEY`.
2. **Contacts → Listes** : créer « Coopérateurs » ; son **ID** est affiché dans la colonne ID du tableau (ou dans le test : « 4 = Coopérateurs ») → `BREVO_LIST_ID=4`. Sans cette variable, les contacts sont créés mais rattachés à aucune liste.
3. Pour envoyer le certificat par e-mail : **Expéditeurs, domaines et IP dédiées → Expéditeurs** → ajouter et **valider** l'adresse d'envoi (ex. `coop@labadjawe.be`) → `BREVO_SENDER_EMAIL` (+ `BREVO_SENDER_NAME`). Authentifiez aussi le domaine (DKIM/DMARC) pour éviter le spam.
4. Si Brevo est configuré avec des **adresses IP autorisées** (Sécurité), désactivez la restriction : Vercel n'utilise pas d'adresse IP fixe.
5. À la validation d'une demande, le contact est créé/mis à jour (attributs `NOM`, `PRENOM`) dans la liste. Le test vérifie la clé, la liste et l'expéditeur.

---
## Dépannage rapide
| Message | Cause probable |
|---|---|
| « partagez la feuille avec … (Lecteur) » | la feuille n'est pas partagée avec l'e-mail du compte de service |
| « compte de service refusé (invalid_grant) » | clé privée tronquée ou horloge ; recollez le JSON complet |
| « Le Sheet est privé » | aucune authentification configurée : ajoutez le compte de service |
| « Colonnes obligatoires : manque … » | renommez la question du formulaire (voir A4) |
| « Odoo : authentification refusée » | `ODOO_DB`, `ODOO_USER` ou `ODOO_API_KEY` incorrect (la clé remplace le mot de passe) |
| « modèle introuvable » / « rôle introuvable » | mauvais `ODOO_SIGN_TEMPLATE_ID` / `ODOO_SIGN_ROLE_ID` (voir la liste du test) |
| « Brevo : HTTP 401 » | clé API incorrecte ou restreinte par IP |
| le bouton reste en « simulation » | variable absente, faute de frappe dans son nom, ou redéploiement oublié |


## Odoo Sign : compatibilité Odoo 18 et 20
- La demande est créée par l'ORM standard : `sign.request.create` avec `template_id`, `reference` (« Souscription La Badjawe - Prénom Nom ») et `request_item_ids` = `[(0, 0, {partner_id, role_id})]` (un élément par rôle du modèle), puis envoi par la méthode publique `action_sent` (sinon `send_signature_accesses`). `sign.request.initialize_new` n'est plus utilisé.
- Les rôles sont lus dans les champs du modèle (`sign.item.responsible_id`), ou imposés par `ODOO_SIGN_ROLE_ID`.
- Si l'envoi échoue après la création, le n° de la demande est conservé : un nouveau clic sur « Envoyer Odoo Sign » relance seulement l'envoi (pas de doublon). Le message affiché est celui d'Odoo, précédé de l'étape en cause.
- Vérification : « 🩺 Tester les connecteurs » affiche la version d'Odoo, le modèle, les rôles et la méthode d'envoi détectée, sans rien créer.
- Transport : JSON-RPC `/jsonrpc`, obsolète depuis Odoo 19 mais maintenu (retrait annoncé : Odoo 22, Odoo Online 21.1). Il est isolé dans la classe `Odoo` (`rpc` / `call`) pour un futur passage à l'API JSON-2.
