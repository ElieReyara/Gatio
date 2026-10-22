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
} as const;
