import { z } from 'zod';
import { payoutMethods } from './events.js';

// Reversements de l'organisateur (maquette O9, contrat §6.4). Un versement par commande payée
// (R21), présenté par événement et par statut.
export const payoutStatuses = ['failed', 'held', 'pending', 'sent'] as const;
export type PayoutStatus = (typeof payoutStatuses)[number];

export const payoutsOverviewSchema = z.object({
  // « Prochain reversement » : somme des versements en attente d'envoi, et le numéro vers
  // lequel ils partent (copié à la vente, R21) ; vide s'ils partent vers plusieurs numéros.
  pendingAmount: z.number().int(),
  pendingTo: z.object({ method: z.enum(payoutMethods), maskedNumber: z.string() }).nullable(),
  hasFailed: z.boolean(),
  groups: z.array(
    z.object({
      eventId: z.uuid(),
      title: z.string(),
      status: z.enum(payoutStatuses),
      amount: z.number().int(),
      count: z.number().int(),
      // Envoyé : dernier envoi ; échoué : dernier échec ; sinon vide.
      date: z.string().nullable(),
    }),
  ),
});
export type PayoutsOverview = z.infer<typeof payoutsOverviewSchema>;
