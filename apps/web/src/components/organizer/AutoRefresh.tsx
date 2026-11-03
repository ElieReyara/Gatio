'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Relit la page côté serveur à intervalle régulier (rapport d'entrée pendant l'événement).
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    // Onglet caché : pas de relecture inutile.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
