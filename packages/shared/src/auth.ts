import { z } from 'zod';

// Formulaires du compte organisateur (maquette O1), validés à l'identique par le site et l'API.
export const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 256;

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const newPassword = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const registerRequestSchema = z.object({
  email,
  password: newPassword,
  displayName: z.string().trim().min(1).max(100),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const passwordForgotRequestSchema = z.object({ email });
export type PasswordForgotRequest = z.infer<typeof passwordForgotRequestSchema>;

export const passwordResetRequestSchema = z.object({
  token: z.string().min(1).max(100),
  newPassword,
});
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

export const organizerProfileSchema = z.object({
  email: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  contactPhone: z.string().nullable(),
  // Numéro de versement masqué (« +235 66 •• •• 56 ») : donnée sensible, jamais renvoyée en entier.
  payoutAccount: z
    .object({ method: z.enum(['airtel_money', 'moov_money']), maskedNumber: z.string() })
    .nullable(),
});
export type OrganizerProfile = z.infer<typeof organizerProfileSchema>;
