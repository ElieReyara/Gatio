import type { OrganizerProfile, PayoutMethod } from '@gatio/shared';
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { organizers, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';

export async function loadProfile(db: DbOrTx, userId: string): Promise<OrganizerProfile> {
  const [row] = await db
    .select({
      email: users.email,
      displayName: organizers.displayName,
      description: organizers.description,
      contactPhone: organizers.contactPhone,
      payoutMethod: organizers.payoutMethod,
      payoutDestination: organizers.payoutDestination,
    })
    .from(organizers)
    .innerJoin(users, eq(users.id, organizers.userId))
    .where(eq(users.id, userId));
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Profil introuvable.');
  const { payoutMethod, payoutDestination, ...profile } = row;
  return {
    ...profile,
    payoutAccount:
      payoutMethod && payoutDestination
        ? {
            method: payoutMethod as PayoutMethod,
            maskedNumber: maskPayoutNumber(payoutDestination),
          }
        : null,
  };
}

// « +235 66 •• •• 56 » (maquettes O2 et O9) : le numéro de versement n'est jamais renvoyé en entier.
export function maskPayoutNumber(e164: string): string {
  const digits = e164.replace(/^\+235/, '');
  return `+235 ${digits.slice(0, 2)} •• •• ${digits.slice(-2)}`;
}
