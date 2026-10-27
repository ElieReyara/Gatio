// Limites d'essais, réglables ici (valeurs de départ, à revoir après le pilote).
// R36 : 3 demandes de réinitialisation par email et par heure.
export const limits = {
  loginPerEmail: { limit: 10, windowSeconds: 15 * 60 },
  loginPerIp: { limit: 30, windowSeconds: 15 * 60 },
  registerPerIp: { limit: 10, windowSeconds: 60 * 60 },
  passwordForgotPerEmail: { limit: 3, windowSeconds: 60 * 60 },
  passwordForgotPerIp: { limit: 20, windowSeconds: 60 * 60 },
  passwordResetPerIp: { limit: 20, windowSeconds: 60 * 60 },
  // R10 : quotas par adresse IP (valeurs de départ).
  orderPerIp: { limit: 20, windowSeconds: 15 * 60 },
  funnelPerIp: { limit: 300, windowSeconds: 15 * 60 },
  paymentPerIp: { limit: 30, windowSeconds: 15 * 60 },
  // Notifications de paiement à signature fausse gardées pour l'enquête, par adresse.
  invalidWebhookPerIp: { limit: 30, windowSeconds: 60 * 60 },
  emailVerifyPerIp: { limit: 30, windowSeconds: 60 * 60 },
  ticketPdfPerIp: { limit: 60, windowSeconds: 15 * 60 },
  // R31 : envois de codes SMS (chaque SMS est payant) ; 1 par minute (renvoi après 60 s, B6).
  otpSendPerPhoneMinute: { limit: 1, windowSeconds: 60 },
  otpSendPerPhone: { limit: 3, windowSeconds: 15 * 60 },
  otpSendPerPhoneDay: { limit: 10, windowSeconds: 24 * 60 * 60 },
  otpSendPerIp: { limit: 20, windowSeconds: 60 * 60 },
  // Plafond global quotidien de SMS (valeur de départ, à régler sur le coût réel).
  otpSendGlobalDay: { limit: 2_000, windowSeconds: 24 * 60 * 60 },
  // Essais de code par adresse, tous numéros confondus (5 essais par code en plus).
  otpVerifyPerIp: { limit: 30, windowSeconds: 15 * 60 },
} as const;

export { MAX_PENDING_ORDERS_PER_PHONE } from '@gatio/shared';

export type Limit = { limit: number; windowSeconds: number };
