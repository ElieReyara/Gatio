import { z } from 'zod';
import { chadPhone, normalizeChadPhone } from './events.js';

// Commande (contrat §6.2) : R10, 10 billets au plus par commande.
export const MAX_TICKETS_PER_ORDER = 10;
export const RESERVATION_MINUTES = 15;
// R10 : réservations en attente au plus par numéro.
export const MAX_PENDING_ORDERS_PER_PHONE = 3;

const contactEmail = z
  .union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email().max(254))])
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

export const orderCreateSchema = z
  .object({
    eventSlug: z.string().regex(/^[a-z0-9]{4,32}$/),
    items: z
      .array(
        z.object({
          // En minuscules : deux écritures du même identifiant ne font pas deux lignes.
          categoryId: z.uuid().transform((id) => id.toLowerCase()),
          quantity: z.number().int().min(1).max(MAX_TICKETS_PER_ORDER),
        }),
      )
      .min(1)
      .max(20),
    contact: z.object({
      name: z.string().trim().min(1).max(100),
      phone: chadPhone,
      email: contactEmail,
    }),
  })
  .refine(
    (order) =>
      order.items.reduce((total, item) => total + item.quantity, 0) <= MAX_TICKETS_PER_ORDER,
    { path: ['items'], message: 'too_many_tickets' },
  )
  .refine(
    (order) => new Set(order.items.map((item) => item.categoryId)).size === order.items.length,
    { path: ['items'], message: 'duplicate_category' },
  );
export type OrderCreate = z.infer<typeof orderCreateSchema>;

// Écran B3 : le numéro est saisi deux fois avant le paiement (journal de bord n° 55) ; un
// billet rattaché à un numéro faux serait visible de son vrai propriétaire.
export function phonesMatch(phone: string, confirmation: string): boolean {
  const first = normalizeChadPhone(phone);
  return first !== null && first === normalizeChadPhone(confirmation);
}

export const orderCreatedSchema = z.object({
  orderId: z.uuid(),
  reference: z.string(),
  total: z.number().int(),
  currency: z.string(),
  reservationExpiresAt: z.string(),
  // Renvoyé une seule fois ; le navigateur le garde pour revenir sur la commande (§3.5).
  orderToken: z.string(),
});
export type OrderCreated = z.infer<typeof orderCreatedSchema>;

export const orderStatuses = [
  'pending',
  'paid',
  'expired',
  'cancelled',
  'needs_review',
  'refunded',
] as const;

// Paiement (contrat §6.2, port Paiement §3.11). Les deux opérateurs de la maquette B4.
export const paymentMethods = ['airtel_money', 'moov_money'] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export const paymentStartSchema = z.object({ method: z.enum(paymentMethods) });

// Prochaine action rendue par le prestataire : le web n'a pas à le connaître.
export const nextActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('redirect'), url: z.url({ protocol: /^https$/ }) }),
  z.object({ type: z.literal('await_phone'), hint: z.string() }),
]);
export type NextAction = z.infer<typeof nextActionSchema>;

export const paymentStatuses = ['pending', 'confirmed', 'failed', 'refunded'] as const;

export const paymentStartedSchema = z.object({
  paymentId: z.uuid(),
  status: z.enum(paymentStatuses),
  next: nextActionSchema,
});
export type PaymentStarted = z.infer<typeof paymentStartedSchema>;

export const orderSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  status: z.enum(orderStatuses),
  event: z.object({
    slug: z.string(),
    title: z.string(),
    startsAt: z.string(),
    venue: z.string(),
    city: z.string(),
  }),
  items: z.array(
    z.object({
      categoryName: z.string(),
      quantity: z.number().int(),
      unitPrice: z.number().int(),
      lineTotal: z.number().int(),
    }),
  ),
  total: z.number().int(),
  currency: z.string(),
  reservationExpiresAt: z.string(),
  remainingSeconds: z.number().int(),
  // Dernier paiement de la commande (null avant le premier essai).
  payment: z
    .object({
      method: z.enum(paymentMethods),
      status: z.enum(paymentStatuses),
      failureReason: z.string().nullable(),
      next: nextActionSchema.nullable(),
    })
    .nullable(),
  // Billets, seulement quand la commande est payée (R23) ; QR signé (§3.6).
  tickets: z.array(
    z.object({
      id: z.uuid(),
      categoryName: z.string(),
      status: z.enum(['valid', 'used', 'void']),
      qr: z.string(),
    }),
  ),
});
export type Order = z.infer<typeof orderSchema>;

// Mesures du parcours envoyées par le navigateur (§8).
export const funnelEventInputSchema = z.object({
  // « payment_confirmed » est écrit par le serveur à la confirmation.
  type: z.enum(['event_view', 'checkout_started', 'payment_initiated']),
  eventSlug: z.string().regex(/^[a-z0-9]{4,32}$/),
  anonSessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  orderId: z.uuid().optional(),
});
