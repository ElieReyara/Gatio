// Tous les textes de l'interface (instructions générales, règle 12).
export const texts = {
  app: {
    name: 'Gatio',
    tagline: 'Vos billets, du lien à l’entrée.',
  },
  health: {
    title: 'État du service',
    ok: 'Le service fonctionne.',
    unavailable: 'Le service est indisponible pour le moment. Réessayez dans quelques minutes.',
  },
  // Maquettes C1 et C2.
  scan: {
    title: 'Contrôle des entrées',
    start: 'Commencer à scanner',
    installTip:
      'Conseil : ajoutez cette page à l’écran d’accueil de votre téléphone pour scanner même sans réseau.',
    listLoading: 'Téléchargement de la liste…',
    listMissing:
      'La liste des billets n’est pas encore sur ce téléphone. Connectez-vous à Internet puis rechargez la page.',
    scannerLoadError:
      'Le lecteur de QR code n’a pas pu être chargé. Connectez-vous à Internet puis rechargez la page.',
    cameraError:
      'La caméra n’est pas accessible. Autorisez-la dans les réglages du navigateur, puis rechargez la page.',
    aim: 'Visez le QR code du billet',
    listReady: 'Liste prête',
    online: 'En ligne',
    offline: 'Hors réseau',
    pending: (count: number) =>
      count === 1 ? '1 passage en attente' : `${count} passages en attente`,
    verifiedIn: (ms: number) => `Vérifié en ${ms} ms`,
    next: 'Touchez l’écran pour le billet suivant',
    valid: 'VALIDE',
    alreadyUsed: 'DÉJÀ UTILISÉ',
    firstPassageAt: (time: string) => `Premier passage à ${time}`,
    invalid: 'INVALIDE',
    invalidDetail: 'Ce QR code n’est pas un billet de cet événement',
    void: 'BILLET ANNULÉ',
    voidDetail: 'Commande remboursée',
  },
  // Page d'essai du prototype (développement seulement, sans maquette : outil interne).
  prototype: {
    title: 'Billets d’essai du scan',
    intro:
      'Billets fictifs signés par l’API. Ouvrez la page de scan sur le téléphone, laissez-la télécharger la liste, puis visez ces QR codes.',
    expected: 'Résultat attendu',
    density: (modules: number, version: number) =>
      `QR version ${version} : ${modules} × ${modules} modules`,
    createAfterDownload: 'Créer un billet vendu après le téléchargement',
    creating: 'Création en cours…',
    expectedLabels: {
      valid: 'vert, VALIDE',
      already_used: 'orange, DÉJÀ UTILISÉ',
      void: 'rouge, BILLET ANNULÉ',
      invalid: 'rouge, INVALIDE',
    },
    unavailable: 'L’API ne répond pas : lancez-la avec pnpm dev.',
  },
  form: {
    show: 'Afficher',
    hide: 'Masquer',
    networkError: 'Le service ne répond pas. Vérifiez votre connexion et réessayez.',
    tooManyAttempts: 'Trop d’essais. Réessayez dans 15 minutes.',
  },
  // Maquettes O1 et E3 (+ « Nom affiché » de O2, ajouté à l'inscription le 22/10/2026).
  organizer: {
    email: 'Votre email',
    emailHelp: 'Vérifiez-le bien : il sert à retrouver votre mot de passe.',
    emailInvalid: 'Indiquez un email valide.',
    password: 'Mot de passe',
    passwordHelp: '8 caractères au minimum.',
    passwordTooShort: 'Le mot de passe doit faire 8 caractères au minimum.',
    displayName: 'Nom affiché',
    displayNameHelp: 'Les acheteurs verront ce nom.',
    displayNameMissing: 'Indiquez le nom que verront les acheteurs.',
    register: {
      title: 'Créez votre compte organisateur',
      lead: 'Publiez votre événement et vendez vos premiers billets en moins d’une heure.',
      submit: 'Créer mon compte',
      submitting: 'Création en cours…',
      terms: 'En créant un compte, vous acceptez les conditions d’utilisation.',
      toLogin: 'J’ai déjà un compte : me connecter',
      alreadyRegistered: 'Un compte existe déjà avec cet email.',
    },
    login: {
      title: 'Connexion',
      failedStrong: 'Email ou mot de passe incorrect.',
      failed: 'Vérifiez vos informations et réessayez.',
      submit: 'Me connecter',
      submitting: 'Connexion en cours…',
      forgot: 'Mot de passe oublié ?',
      toRegister: 'Pas encore de compte : m’inscrire',
    },
    forgot: {
      title: 'Mot de passe oublié',
      lead: 'Indiquez l’email de votre compte. Nous vous enverrons un lien pour choisir un nouveau mot de passe.',
      submit: 'Envoyer le lien',
      submitting: 'Envoi en cours…',
      backToLogin: 'Retour à la connexion',
      sentTitle: 'Regardez votre boîte email',
      sentBefore:
        'Si cette adresse correspond à un compte, un email vient d’être envoyé. Le lien est valable ',
      sentStrong: '30 minutes',
      sentAfter: '.',
      notReceived:
        'Vous ne le voyez pas ? Regardez dans vos courriers indésirables, ou vérifiez l’adresse saisie.',
      resend: 'Renvoyer le lien',
    },
    reset: {
      title: 'Choisissez un nouveau mot de passe',
      password: 'Nouveau mot de passe',
      submit: 'Enregistrer le mot de passe',
      submitting: 'Enregistrement en cours…',
      signOutNotice: 'Pour votre sécurité, vous serez déconnecté de tous vos appareils.',
      done: 'Mot de passe modifié. Connectez-vous avec le nouveau.',
      toLogin: 'Me connecter',
      expired:
        'Ce lien n’est plus valable. Il expire au bout de 30 minutes et ne sert qu’une fois.',
      newLink: 'Demander un nouveau lien',
    },
    // Page provisoire après connexion (« Mes événements » arrive en tranche 3).
    home: {
      connectedAs: (name: string) => `Vous êtes connecté : ${name}.`,
      logout: 'Me déconnecter',
    },
  },
} as const;
