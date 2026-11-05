/**
 * Google Apps Script : crée le formulaire de souscription de la Brasserie Coopérative La Badjawe
 * et le relie à un nouveau Google Sheet de réponses.
 *
 * Mode d'emploi :
 *   1. https://script.google.com → Nouveau projet → effacer le contenu de Code.gs → coller ce fichier → Enregistrer (Ctrl+S).
 *   2. Dans la barre du haut, choisir la fonction « creerFormulaireSouscription » → Exécuter → autoriser l'accès (Forms, Sheets).
 *   3. Les liens du formulaire (édition + diffusion) et du Sheet s'affichent dans le Journal d'exécution.
 *
 * Les intitulés de questions ci-dessous sont RECONNUS par l'import de l'application « Coopérateurs » (lib/cooperateurs/sheet.ts) :
 * vous pouvez modifier les textes d'aide, mais gardez les intitulés des questions et le texte des réponses « Oui » / « Non ».
 *
 * Déroulé du formulaire :
 *   Page 1  Démarche (pour moi / cadeau), classe de parts, nombre de parts
 *   Page 2  Bénéficiaire des parts  (affichée UNIQUEMENT pour « Comme cadeau / pour un mineur »)
 *   Page 3  Souscripteur (la personne qui paie) + adresse
 *   Page 4  Talents & métiers (facultatif)
 *   Page 5  Consentements (téléphone, newsletter) et adhésion aux statuts
 */

var TITRE = 'Brasserie Coopérative La Badjawe — Bulletin de souscription de parts';

var DESCRIPTION =
  'Merci de rejoindre l’aventure de La Badjawe, la brasserie coopérative !\n\n' +
  'Une part sociale vaut 250 €. En devenant coopératrice ou coopérateur, vous financez une brasserie locale et vous participez, ' +
  'selon le principe « une personne, une voix », à la vie démocratique de la coopérative (assemblée générale, information, ' +
  'groupes de travail).\n\n' +
  'Vous pouvez souscrire pour vous-même, ou offrir des parts à une autre personne, par exemple à un enfant : dans ce cas, ' +
  'vous restez le souscripteur et nous enregistrons aussi le bénéficiaire.\n\n' +
  'Vos données sont utilisées uniquement pour la gestion du registre des coopérateurs et, si vous l’acceptez, pour vous tenir informé(e). ' +
  'Une fois le formulaire envoyé, vous recevrez le bulletin à signer et les instructions de paiement par e-mail.';

/** Texte exact des réponses : l'import ne considère comme consentement qu'une réponse commençant par « Oui ». */
var OUI_NEWSLETTER = 'Oui, j’accepte de recevoir les actualités et la newsletter de La Badjawe par e-mail';

function creerFormulaireSouscription() {
  var f = FormApp.create(TITRE);
  f.setDescription(DESCRIPTION)
    .setCollectEmail(false)
    .setAllowResponseEdits(false)
    .setProgressBar(true)
    .setShowLinkToRespondAgain(false)
    .setConfirmationMessage('Merci ! Votre demande de souscription a bien été enregistrée. Vous recevrez prochainement un e-mail avec la suite de la procédure.');

  // ===================== PAGE 1 : démarche, classe de parts, nombre de parts =====================
  var qDemarche = f.addMultipleChoiceItem();          // les choix (avec navigation) sont définis plus bas
  qDemarche.setTitle('Cette souscription est effectuée :').setRequired(true);

  f.addMultipleChoiceItem()
    .setTitle('Vous souscrivez en qualité de :')
    .setChoiceValues(['Particulier (Parts B)', 'Entreprise / Indépendant (Parts D)', 'Institution (Parts C)'])
    .setRequired(true);

  f.addTextItem()
    .setTitle('Nombre de parts souhaité :')
    .setHelpText('Nombre entier, au minimum 1 (une part = 250 €).')
    .setValidation(FormApp.createTextValidation()
      .requireTextMatchesPattern('^[1-9][0-9]*$')
      .setHelpText('Indiquez un nombre entier supérieur ou égal à 1.')
      .build())
    .setRequired(true);

  // ===================== PAGE 2 : bénéficiaire (cadeau / mineur) =====================
  f.addPageBreakItem()
    .setTitle('Bénéficiaire des parts')
    .setHelpText('Les parts seront offertes à la personne ci-dessous. Vous (le souscripteur) restez responsable du paiement et, pour un mineur, de sa représentation légale.');
  f.addTextItem().setTitle('Nom du bénéficiaire').setRequired(true);
  f.addTextItem().setTitle('Prénom du bénéficiaire').setRequired(true);
  f.addDateItem().setTitle('Date de naissance du bénéficiaire').setIncludesYear(true).setRequired(true);
  f.addMultipleChoiceItem()
    .setTitle('Lien de parenté / Représentation légale')
    .setChoiceValues(['Parent', 'Grand-parent', 'Parrain/Marraine', 'Proche'])
    .setRequired(true);
  f.addTextItem()
    .setTitle('Email de contact du bénéficiaire')
    .setHelpText('Facultatif.')
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().setHelpText('Adresse e-mail invalide.').build());

  // ===================== PAGE 3 : souscripteur (la personne qui paie) =====================
  var pageSouscripteur = f.addPageBreakItem()
    .setTitle('Souscripteur (la personne qui paie)')
    .setHelpText('Vos coordonnées : c’est à cette adresse que seront envoyés le bulletin à signer et le certificat de parts.');
  f.addTextItem().setTitle('Nom du souscripteur').setRequired(true);
  f.addTextItem().setTitle('Prénom du souscripteur').setRequired(true);
  f.addTextItem()
    .setTitle('Email du souscripteur')
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().setHelpText('Adresse e-mail invalide.').build())
    .setRequired(true);
  f.addTextItem().setTitle('Téléphone').setRequired(true);                       // intitulé exact : « Téléphone »
  f.addTextItem()
    .setTitle('Dénomination sociale (entreprise / institution)')
    .setHelpText('Facultatif : uniquement pour une entreprise, un indépendant ou une institution.');
  f.addTextItem()
    .setTitle('Numéro d’entreprise / BCE')
    .setHelpText('Facultatif : uniquement pour une entreprise, un indépendant ou une institution.');
  f.addTextItem()
    .setTitle('Registre National')
    .setHelpText('Facultatif : numéro de registre national (particuliers). Il sert à vérifier votre identité et à éviter les doublons dans le registre.');
  f.addTextItem().setTitle('Rue et numéro').setRequired(true);
  f.addTextItem().setTitle('Code postal').setRequired(true);
  f.addTextItem().setTitle('Ville').setRequired(true);
  f.addTextItem().setTitle('Pays').setRequired(true);

  // ===================== PAGE 4 : talents & métiers =====================
  f.addPageBreakItem()
    .setTitle('Vos compétences et talents (facultatif)')
    .setHelpText('La coopérative valorise les savoir-faire de ses membres. Vos réponses ne sont visibles que des gestionnaires du registre, ' +
      'et vous n’êtes listé(e) que si vous acceptez, plus bas, d’être contacté(e) par téléphone.');
  f.addTextItem().setTitle('Métier / Profession');
  f.addParagraphTextItem()
    .setTitle('Compétences, talents et savoir-faire que vous souhaitez mettre au service de la coopérative')
    .setHelpText('Séparez vos compétences par des virgules, par exemple : comptabilité, menuiserie, communication, événementiel, électricité, droit');

  // ===================== PAGE 5 : consentements & statuts =====================
  f.addPageBreakItem()
    .setTitle('Consentements et statuts')
    .setHelpText('Ces réponses sont libres : un « Non » (ou l’absence de réponse) n’a aucune conséquence sur votre souscription.');
  f.addMultipleChoiceItem()
    .setTitle('Acceptez-vous d’être contacté(e) par téléphone en cas de besoin de vos compétences pour la coopérative ?')
    .setChoiceValues(['Oui', 'Non']);                                             // aucune réponse présélectionnée, non obligatoire
  f.addMultipleChoiceItem()
    .setTitle('Information et vie de la coopérative (Newsletter)')
    .setHelpText('Vous pouvez vous désinscrire à tout moment via le lien présent dans chaque e-mail.')
    .setChoiceValues([OUI_NEWSLETTER, 'Non']);
  f.addCheckboxItem()
    .setTitle('Adhésion aux statuts et traitement des données')
    .setHelpText('Les statuts sont disponibles auprès de la coopérative. Vos données personnelles sont traitées uniquement pour la tenue du registre légal des coopérateurs.')
    .setChoiceValues(['J’accepte les statuts de la coopérative et le traitement légal de mes données dans le registre des coopérateurs'])
    .setRequired(true);

  // ===================== Navigation : « cadeau » passe par la page 2, « pour moi-même » saute directement à la page 3 =====================
  qDemarche.setChoices([
    qDemarche.createChoice('Pour moi-même', pageSouscripteur),
    qDemarche.createChoice('Comme cadeau / pour un mineur', FormApp.PageNavigationType.CONTINUE)
  ]);

  // ===================== Sheet de réponses lié =====================
  var ss = SpreadsheetApp.create('Réponses — ' + TITRE);
  f.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  Logger.log('Formulaire (modifier) : ' + f.getEditUrl());
  Logger.log('Formulaire (à diffuser) : ' + f.getPublishedUrl());
  Logger.log('Sheet des réponses : ' + ss.getUrl());
  Logger.log('Identifiant du Sheet (variable GOOGLE_SHEET_ID de l’application) : ' + ss.getId());
}
