import { z } from 'zod';

// Contrôleurs invités (R29, contrat §6.4 et §6.5, maquettes C1 et O7).
// Le lien expire 24 h après le début de l'événement.
export const SCANNER_INVITE_HOURS = 24;
// 401 de la session de scan : un jeton a été présenté mais ne vaut plus (lien désactivé,
// contrôleur retiré, événement annulé ou terminé) ; la page de scan le dit au contrôleur.
export const SCAN_SESSION_ENDED = 'session_ended';
const FIRST_NAME_MAX = 40;

const inviteToken = z.string().min(1).max(100);

export const scanInviteCheckSchema = z.object({ inviteToken });

export const scanJoinSchema = z.object({
  inviteToken,
  firstName: z.string().trim().min(1).max(FIRST_NAME_MAX),
});

export const scanEventSchema = z.object({
  title: z.string(),
  startsAt: z.string(),
  venue: z.string(),
  city: z.string(),
});
export type ScanEvent = z.infer<typeof scanEventSchema>;

export const scanInviteInfoSchema = z.object({ event: scanEventSchema });

export const scanSessionSchema = z.object({
  firstName: z.string(),
  expiresAt: z.string(),
  event: scanEventSchema,
});
export type ScanSession = z.infer<typeof scanSessionSchema>;

export const scannerInviteSchema = z.object({
  id: z.uuid(),
  createdAt: z.string(),
  expiresAt: z.string(),
  active: z.boolean(),
});
export type ScannerInvite = z.infer<typeof scannerInviteSchema>;

// Le jeton n'est donné qu'une fois, à la création : seule son empreinte est gardée.
export const scannerInviteCreatedSchema = z.object({
  invite: scannerInviteSchema,
  token: z.string(),
});
export type ScannerInviteCreated = z.infer<typeof scannerInviteCreatedSchema>;

export const scannerInviteListSchema = z.object({ items: z.array(scannerInviteSchema) });

export const scannerSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  joinedAt: z.string(),
  lastSeenAt: z.string(),
  // Session ouverte par l'organisateur lui-même (« scanner moi-même »), sans invitation.
  organizer: z.boolean(),
});
export type Scanner = z.infer<typeof scannerSchema>;

export const scannerListSchema = z.object({ items: z.array(scannerSchema) });
