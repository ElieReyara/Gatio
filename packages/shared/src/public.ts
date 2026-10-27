import { z } from 'zod';
import { eventStatuses, eventTypes } from './events.js';

// Pages publiques (contrat §6.2) : aucune donnée sur les ventes ni sur l'organisateur
// au-delà de son nom affiché.
export const categoryAvailabilities = ['available', 'upcoming', 'ended', 'sold_out'] as const;
export type CategoryAvailability = (typeof categoryAvailabilities)[number];

export const publicCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  priceAmount: z.number().int(),
  currency: z.string(),
  saleStartsAt: z.string().nullable(),
  saleEndsAt: z.string(),
  availability: z.enum(categoryAvailabilities),
});
export type PublicCategory = z.infer<typeof publicCategorySchema>;

export const publicEventSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  eventType: z.enum(eventTypes),
  city: z.string(),
  venue: z.string(),
  startsAt: z.string(),
  imageUrl: z.string().nullable(),
  // « À partir de » (maquette B1) : plus petit prix des catégories en vente.
  minPriceAmount: z.number().int().nullable(),
  currency: z.string(),
});
export type PublicEventSummary = z.infer<typeof publicEventSummarySchema>;

export const publicEventListSchema = z.object({
  items: z.array(publicEventSummarySchema),
  nextCursor: z.string().nullable(),
});

export const publicEventSchema = publicEventSummarySchema.extend({
  description: z.string(),
  status: z.enum(eventStatuses),
  organizerName: z.string(),
  categories: z.array(publicCategorySchema),
  // Code SMS demandé avant de réserver (journal de bord n° 71) : le site n'affiche la double
  // saisie du numéro que si la vérification est coupée.
  phoneVerification: z.boolean(),
});
export type PublicEvent = z.infer<typeof publicEventSchema>;

export const publicEventQuerySchema = z.object({
  city: z.string().optional(),
  type: z.enum(eventTypes).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
