import { z } from 'zod';

// Codes d'erreur du contrat d'API (cahier de conception §6.1).
export const errorCodes = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'STOCK_INSUFFICIENT',
  'PRICE_TOO_LOW',
  'EVENT_NOT_ON_SALE',
  'RESERVATION_EXPIRED',
  'PAYMENT_NOT_CONFIRMED',
  'INVITE_INVALID',
  'CATEGORY_NOT_ON_SALE',
  'TOKEN_INVALID',
  'MFA_REQUIRED',
  'MFA_INVALID',
  'INTERNAL_ERROR',
] as const;

export const errorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
