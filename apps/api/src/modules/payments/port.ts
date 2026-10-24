import type { NextAction, PaymentMethod } from '@gatio/shared';

// Port Paiement (conception §3.11) : démarrer un paiement, vérifier une notification,
// interroger un statut. Le reste du programme ne connaît aucun prestataire.
export type ProviderResult = {
  providerRef: string;
  // Notre référence (identifiant du paiement) donnée au démarrage, si le prestataire la
  // renvoie : retrouve un paiement dont la réponse de démarrage s'est perdue.
  reference?: string | null;
  status: 'confirmed' | 'failed';
  amount: number;
  currency: string;
  failureReason?: string | null;
  // Numéro Mobile Money qui a payé, si le prestataire le donne (facultatif, §3.11).
  payerPhone?: string | null;
};

export type ProviderStatus =
  { status: 'pending' | 'unknown' } | ({ status: 'confirmed' | 'failed' } & ProviderResult);

export type VerifiedNotification = {
  // Identifiant de la notification chez le prestataire (ou empreinte du contenu).
  eventId: string;
  signatureValid: boolean;
  payload: unknown;
};

export type PaymentPort = {
  name: string;
  start(input: {
    reference: string;
    amount: number;
    currency: string;
    method: PaymentMethod;
    phone: string;
  }): Promise<{ providerRef: string; next: NextAction }>;
  // Vérifie la signature sur le corps brut, avant toute lecture du contenu (R15).
  verifyNotification(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): VerifiedNotification;
  // Lit une notification dont la signature a été vérifiée ; null si elle ne sert à rien.
  readNotification(payload: unknown): ProviderResult | null;
  getStatus(providerRef: string): Promise<ProviderStatus>;
};
