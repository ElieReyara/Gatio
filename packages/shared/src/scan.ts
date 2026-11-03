import { z } from 'zod';

// Scan des billets (R24 à R27, contrat §6.5). Les portes viendront en tranche 11.

export const scanTicketSchema = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  status: z.enum(['valid', 'used', 'void']),
  // Heure du premier passage accepté (« Premier passage à 19 h 42 », maquette C2).
  usedAt: z.string().nullable(),
});
export type ScanTicket = z.infer<typeof scanTicketSchema>;

// Liste du scan (« manifeste ») : clés publiques, catégories, billets de l'événement.
export const scanManifestSchema = z.object({
  eventId: z.uuid(),
  keys: z.array(z.object({ keyId: z.number().int().min(0).max(255), publicKey: z.string() })),
  categories: z.array(z.object({ id: z.uuid(), name: z.string() })),
  tickets: z.array(scanTicketSchema),
  cursor: z.string(),
});
export type ScanManifest = z.infer<typeof scanManifestSchema>;

// Ce que le téléphone a affiché (« mauvaise porte » : tranche 11).
export const scanResults = ['valid', 'already_used', 'wrong_gate', 'void', 'invalid'] as const;
export type ScanResult = (typeof scanResults)[number];

// Décision du serveur pour un passage (R26).
export const passageOutcomes = [
  'accepted',
  'duplicate',
  'unknown_ticket',
  'void_ticket',
  'wrong_event',
] as const;
export type PassageOutcome = (typeof passageOutcomes)[number];

export const SCAN_PASSAGES_PER_BATCH = 100;

export const scanPassageSchema = z.object({
  // Créé par le téléphone : rejouer un envoi ne crée pas de doublon.
  id: z.uuid(),
  ticketId: z.uuid().nullable(),
  scannedAt: z.iso.datetime({ offset: true }),
  localResult: z.enum(scanResults),
  verifyMs: z.number().int().min(0).max(600_000),
  // QR lu (sans donnée personnelle) : le serveur vérifie sa signature avant d'utiliser le
  // billet ; un identifiant seul, lisible dans la liste, ne suffit pas.
  qr: z.string().max(300).nullable(),
});
export type ScanPassage = z.infer<typeof scanPassageSchema>;

export const scanPassagesRequestSchema = z.object({
  passages: z.array(scanPassageSchema).min(1).max(SCAN_PASSAGES_PER_BATCH),
});

export const scanPassagesResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.uuid(),
      outcome: z.enum(passageOutcomes),
      usedAt: z.string().nullable(),
    }),
  ),
});

export const scanChangesQuerySchema = z.object({ since: z.iso.datetime({ offset: true }) });

// R27 : billets ajoutés, utilisés ou annulés depuis le curseur moins 30 s.
export const scanChangesSchema = z.object({
  tickets: z.array(scanTicketSchema),
  cursor: z.string(),
});
export type ScanChanges = z.infer<typeof scanChangesSchema>;

// Chevauchement du curseur des changements (R27).
export const SCAN_CHANGES_OVERLAP_SECONDS = 30;

// Rapport d'entrée (maquette O8).
export const entryReportSchema = z.object({
  entered: z.number().int(),
  sold: z.number().int(),
  duplicates: z.number().int(),
  // Téléphones qui ont la liste et se sont manifestés ces 2 dernières minutes.
  phonesUpToDate: z.number().int(),
  latest: z.array(
    z.object({
      id: z.uuid(),
      receivedAt: z.string(),
      outcome: z.enum(passageOutcomes),
      categoryName: z.string().nullable(),
      orderReference: z.string().nullable(),
      scannerName: z.string(),
      // Pour un doublon : heure du premier passage accepté.
      usedAt: z.string().nullable(),
    }),
  ),
});
export type EntryReport = z.infer<typeof entryReportSchema>;
