// Réglages du site lus côté serveur : adresse publique (liens de vente, aperçus de partage)
// et moyens de contact du support (R35, page de support : journal de bord n° 66).
export function siteUrl(): string {
  return (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function supportContacts(): { whatsapp: string | null; email: string | null } {
  const whatsapp = (process.env.SUPPORT_WHATSAPP ?? '').replace(/\D/g, '');
  const email = (process.env.SUPPORT_EMAIL ?? '').trim();
  return { whatsapp: whatsapp || null, email: email || null };
}
