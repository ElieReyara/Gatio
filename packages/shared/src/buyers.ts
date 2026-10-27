import { z } from 'zod';
import { chadPhone, eventStatuses } from './events.js';

// Connexion de l'acheteur par code SMS (R31, contrat §6.3, maquettes B6 et M1).
export const OTP_VALID_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 5;
// Délai avant de pouvoir redemander un code (« Vous pouvez renvoyer le code dans 0:42 »).
export const OTP_RESEND_SECONDS = 60;
// Après trop d'essais : « réessayez dans 15 minutes » (B6).
export const OTP_LOCK_MINUTES = 15;

export const otpRequestSchema = z.object({ phone: chadPhone });

export const otpVerifySchema = z.object({
  phone: chadPhone,
  // Le code peut être recopié avec l'espace du SMS (« 481 902 »).
  code: z
    .string()
    .transform((value) => value.replace(/\s/g, ''))
    .pipe(z.string().regex(/^\d{6}$/)),
});

// Motifs (details.reason) que l'écran sait expliquer.
export const PHONE_VERIFICATION_REQUIRED = 'phone_verification_required';
export const OTP_LOCKED = 'otp_locked';

// « Mes billets » (B7) : billets de l'acheteur connecté, par événement puis par commande.
export const myTicketsEventSchema = z.object({
  event: z.object({
    slug: z.string(),
    title: z.string(),
    startsAt: z.string(),
    venue: z.string(),
    city: z.string(),
    status: z.enum(eventStatuses),
  }),
  past: z.boolean(),
  orders: z.array(
    z.object({
      orderId: z.uuid(),
      reference: z.string(),
      lines: z.array(z.object({ categoryName: z.string(), quantity: z.number().int() })),
      tickets: z.array(
        z.object({
          id: z.uuid(),
          // « Billet 1 sur 2 » : numéro dans la commande, comme sur le PDF.
          index: z.number().int(),
          categoryName: z.string(),
          status: z.enum(['valid', 'used', 'void']),
        }),
      ),
    }),
  ),
});
export type MyTicketsEvent = z.infer<typeof myTicketsEventSchema>;

export const myTicketsSchema = z.object({
  items: z.array(myTicketsEventSchema),
  // Liste courte, sans pagination (format des listes du contrat §6.1).
  nextCursor: z.null(),
});
export type MyTickets = z.infer<typeof myTicketsSchema>;
