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
} as const;

export { MAX_PENDING_ORDERS_PER_PHONE } from '@gatio/shared';

export type Limit = { limit: number; windowSeconds: number };
