import { z } from 'zod';

// Tableau de bord d'un événement (maquette O6, contrat §6.4) : commandes payées seulement.
export const eventStatsSchema = z.object({
  sold: z.number().int(),
  total: z.number().int(),
  // Montant payé par les acheteurs et montant reversé à l'organisateur (frais déduits).
  paidAmount: z.number().int(),
  payoutAmount: z.number().int(),
  currency: z.string(),
  categories: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      sold: z.number().int(),
      // Encore en vente : total moins vendus et réservations en cours.
      remaining: z.number().int(),
      archived: z.boolean(),
    }),
  ),
});
export type EventStats = z.infer<typeof eventStatsSchema>;
