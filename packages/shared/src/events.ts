import { z } from 'zod';

// Liste fixe des villes (journal de bord n° 53 et 64) et des types d'événement (n° 46).
export const cities = [
  "N'Djamena",
  'Moundou',
  'Sarh',
  'Abéché',
  'Kélo',
  'Koumra',
  'Pala',
  'Am Timan',
  'Bongor',
  'Mongo',
  'Doba',
  'Ati',
] as const;
export type City = (typeof cities)[number];

export const eventTypes = ['concert', 'party', 'sport', 'conference', 'culture', 'other'] as const;
export type EventType = (typeof eventTypes)[number];

export const eventStatuses = ['draft', 'published', 'postponed', 'cancelled', 'suspended'] as const;
export type EventStatus = (typeof eventStatuses)[number];

export const CURRENCY = 'XAF';
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// Numéros tchadiens : 8 chiffres, indicatif +235 (R30, journal n° 39).
export function normalizeChadPhone(input: string): string | null {
  const digits = input.replace(/[\s.-]/g, '').replace(/^(\+|00)235/, '');
  return /^\d{8}$/.test(digits) ? `+235${digits}` : null;
}

export const chadPhone = z.string().transform((value, context) => {
  const phone = normalizeChadPhone(value);
  if (!phone) context.addIssue({ code: 'custom', message: 'invalid_chad_phone' });
  return phone ?? '';
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

// Profil (maquette O2).
export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  description: optionalText(1000),
  contactPhone: z
    .union([z.literal(''), chadPhone])
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
});
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const payoutMethods = ['airtel_money', 'moov_money'] as const;
export type PayoutMethod = (typeof payoutMethods)[number];

export const payoutAccountSchema = z.object({
  method: z.enum(payoutMethods),
  number: chadPhone,
});
export type PayoutAccountInput = z.input<typeof payoutAccountSchema>;

// Caractères que les polices standard du billet PDF savent écrire (WinAnsi : alphabet latin
// avec ses accents, guillemets, tirets, €). Au lancement, ce qui est imprimé sur le billet s'y
// limite (journal de bord n° 74) ; les autres écritures demanderont une police intégrée.
const TICKET_PRINTABLE =
  /^[\t\n\r\u0020-\u007E\u00A0-\u00FF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018-\u201A\u201C-\u201E\u2020-\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]*$/;
export const isPrintableOnTicket = (text: string) => TICKET_PRINTABLE.test(text);
export const UNSUPPORTED_CHARACTERS = 'unsupported_characters';

const ticketText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(isPrintableOnTicket, { message: UNSUPPORTED_CHARACTERS });

// Événement (maquette O3). Description en texte brut (S3).
const eventFields = {
  title: ticketText(120),
  description: z.string().trim().min(1).max(5000),
  eventType: z.enum(eventTypes),
  city: z.enum(cities),
  venue: ticketText(200),
  startsAt: z.iso.datetime({ offset: true }),
  capacity: z.coerce.number().int().min(1).max(100_000),
};
export const eventCreateSchema = z.object(eventFields);
export type EventCreate = z.infer<typeof eventCreateSchema>;
export const eventUpdateSchema = z.object(eventFields).partial();
export type EventUpdate = z.infer<typeof eventUpdateSchema>;

// Catégorie de billets (maquette O4), période de vente facultative (R12).
const categoryFields = {
  name: ticketText(60),
  priceAmount: z.coerce.number().int().min(1).max(100_000_000),
  quantityTotal: z.coerce.number().int().min(1).max(100_000),
  saleStartsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  saleEndsAt: z.iso.datetime({ offset: true }).nullable().optional(),
};
export const categoryCreateSchema = z.object(categoryFields);
export type CategoryCreate = z.infer<typeof categoryCreateSchema>;
export const categoryUpdateSchema = z.object(categoryFields).partial();
export type CategoryUpdate = z.infer<typeof categoryUpdateSchema>;

// Aperçu des frais (R7) : les mêmes nombres que ceux figés à la commande (R2, R5).
export const feePreviewRequestSchema = z.object({
  price: z.coerce.number().int().min(1).max(100_000_000),
  eventId: z.uuid().optional(),
});
export const feePreviewSchema = z.object({
  price: z.number().int(),
  percentBps: z.number().int(),
  percentAmount: z.number().int(),
  fixedAmount: z.number().int(),
  feeAmount: z.number().int(),
  payoutAmount: z.number().int(),
  currency: z.string(),
  priceTooLow: z.boolean(),
});
export type FeePreview = z.infer<typeof feePreviewSchema>;

export const categorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  priceAmount: z.number().int(),
  currency: z.string(),
  quantityTotal: z.number().int(),
  quantitySold: z.number().int(),
  quantityReserved: z.number().int(),
  saleStartsAt: z.string().nullable(),
  saleEndsAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  fee: feePreviewSchema,
});
export type Category = z.infer<typeof categorySchema>;

export const organizerEventSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  eventType: z.enum(eventTypes),
  city: z.string(),
  venue: z.string(),
  startsAt: z.string(),
  capacity: z.number().int(),
  status: z.enum(eventStatuses),
  imageUrl: z.string().nullable(),
});
export type OrganizerEvent = z.infer<typeof organizerEventSchema>;

export const organizerEventDetailSchema = organizerEventSchema.extend({
  categories: z.array(categorySchema),
});
export type OrganizerEventDetail = z.infer<typeof organizerEventDetailSchema>;

export const organizerEventListSchema = z.object({
  items: z.array(organizerEventSchema),
  nextCursor: z.string().nullable(),
});
