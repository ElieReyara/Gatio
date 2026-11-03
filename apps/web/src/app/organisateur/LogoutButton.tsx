'use client';

import { useRouter } from 'next/navigation';
import { postJson } from '@/lib/api-client';
import { texts } from '@/texts/fr';

// Liens d'invitation gardés par ce navigateur (onglet « Contrôleurs ») : effacés à la
// déconnexion, pour qu'un ordinateur partagé ne les garde pas.
function forgetInviteLinks() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('gatio-invite-')) localStorage.removeItem(key);
    }
  } catch {
    // Stockage indisponible : rien n'y a été gardé.
  }
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="link link-button"
      onClick={async () => {
        await postJson('/auth/logout');
        forgetInviteLinks();
        router.push('/organisateur/connexion');
        router.refresh();
      }}
    >
      {texts.space.profile.logout}
    </button>
  );
}
