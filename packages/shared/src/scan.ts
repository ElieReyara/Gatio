import { z } from 'zod';

// Liste du scan (« manifeste », contrat §6.5). Les portes viendront en tranche 11.
export const scanManifestSchema = z.object({
  eventId: z.string().uuid(),
  keys: z.array(z.object({ keyId: z.number().int().min(0).max(255), publicKey: z.string() })),
  categories: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  tickets: z.array(
    z.object({
      id: z.string().uuid(),
      categoryId: z.string().uuid(),
      status: z.enum(['valid', 'used', 'void']),
    }),
  ),
  cursor: z.string(),
});
export type ScanManifest = z.infer<typeof scanManifestSchema>;

// Billets d'essai du prototype de la tranche 1 (développement seulement).
export const prototypeSampleSchema = z.object({
  label: z.string(),
  expected: z.enum(['valid', 'already_used', 'void', 'invalid']),
  qr: z.string(),
});
export type PrototypeSample = z.infer<typeof prototypeSampleSchema>;

export const prototypeSamplesResponseSchema = z.object({ items: z.array(prototypeSampleSchema) });
