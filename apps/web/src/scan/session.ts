// Ce téléphone a rejoint un contrôle (lien d'invitation ou « scanner moi-même ») : sans session
// valable, la page de scan dit alors que l'accès n'est plus valable, au lieu du prototype.
const JOINED_KEY = 'gatio-scan-joined';

export function markJoined() {
  try {
    localStorage.setItem(JOINED_KEY, '1');
  } catch {
    // Stockage indisponible (navigation privée) : la page de scan le vérifiera en ligne.
  }
}

export function hasJoined(): boolean {
  try {
    return localStorage.getItem(JOINED_KEY) === '1';
  } catch {
    return false;
  }
}
