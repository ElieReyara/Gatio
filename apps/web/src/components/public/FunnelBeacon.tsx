'use client';

import { useEffect } from 'react';
import { trackFunnel } from '@/lib/buyer-storage';

// Une mesure par affichage de page (§8 : ouverture de la page, début de commande).
export function FunnelBeacon({
  type,
  eventSlug,
}: {
  type: 'event_view' | 'checkout_started';
  eventSlug: string;
}) {
  useEffect(() => {
    trackFunnel(type, eventSlug);
  }, [type, eventSlug]);
  return null;
}
