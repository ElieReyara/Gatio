'use client';

import { useRouter } from 'next/navigation';
import { postJson } from '@/lib/api-client';
import { texts } from '@/texts/fr';

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="link link-button"
      onClick={async () => {
        await postJson('/auth/logout');
        router.push('/organisateur/connexion');
        router.refresh();
      }}
    >
      {texts.organizer.home.logout}
    </button>
  );
}
