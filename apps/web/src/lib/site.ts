import { headers } from 'next/headers';

// Réglages du site lus côté serveur.

// Adresse publique (liens de vente, aperçus de partage) : SITE_URL si elle est réglée ;
// sinon celle de la requête reçue (hôte transmis par le tunnel ou le relais). Ne plante
// jamais : un lien de vente reste utilisable (registre d'erreurs ERR-010).
export async function siteUrl(): Promise<string> {
  const configured = process.env.SITE_URL;
  if (configured) return configured.replace(/\/$/, '');
  const requestHeaders = await headers();
  const host =
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:3000';
  const protocol =
    requestHeaders.get('x-forwarded-proto') ??
    (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https');
  return `${protocol.split(',')[0]}://${host.split(',')[0]}`;
}

// Moyens de contact de la page de support (R35 adapté, journal de bord n° 66).
export function supportContacts(): { whatsapp: string | null; email: string | null } {
  const whatsapp = (process.env.SUPPORT_WHATSAPP ?? '').replace(/\D/g, '');
  const email = (process.env.SUPPORT_EMAIL ?? '').trim();
  return { whatsapp: whatsapp || null, email: email || null };
}
