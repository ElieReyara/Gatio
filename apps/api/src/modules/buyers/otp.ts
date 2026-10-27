import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { OTP_LOCK_MINUTES, OTP_MAX_ATTEMPTS, OTP_VALID_MINUTES } from '@gatio/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { otpCodes } from '../../db/schema.js';

// Code de connexion de l'acheteur (R31) : 6 chiffres, haché avec un secret serveur,
// valable 5 minutes, 5 essais, usage unique ; seul le dernier code envoyé est valable.

export function otpHash(secret: string, phone: string, code: string): string {
  return createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex');
}

// Maquette M1 : environ 80 caractères, un seul SMS, aucun lien (hameçonnage).
export function otpSmsText(code: string): string {
  return `Gatio : votre code est ${code.slice(0, 3)} ${code.slice(3)}. Il est valable ${OTP_VALID_MINUTES} minutes. Ne le donnez à personne.`;
}

// Trop d'essais faux sur un code récent : plus de code pour ce numéro pendant 15 minutes au
// moins après le dernier essai (B6 : « réessayez dans 15 minutes »). Un code juste au 5e
// essai est consommé : il ne bloque rien.
export async function isOtpLocked(db: Db, phone: string): Promise<boolean> {
  const [locked] = await db
    .select({ id: otpCodes.id })
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.phoneE164, phone),
        sql`${otpCodes.attempts} >= ${OTP_MAX_ATTEMPTS}`,
        isNull(otpCodes.consumedAt),
        sql`${otpCodes.createdAt} > now() - make_interval(mins => ${OTP_LOCK_MINUTES + OTP_VALID_MINUTES})`,
      ),
    )
    .limit(1);
  return Boolean(locked);
}

// Nouveau code : les précédents du numéro ne valent plus rien.
export async function createOtp(db: Db, secret: string, phone: string, ip: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.transaction(async (tx) => {
    await tx
      .update(otpCodes)
      .set({ consumedAt: sql`now()` })
      .where(and(eq(otpCodes.phoneE164, phone), isNull(otpCodes.consumedAt)));
    await tx.insert(otpCodes).values({
      phoneE164: phone,
      codeHash: otpHash(secret, phone, code),
      expiresAt: sql`now() + make_interval(mins => ${OTP_VALID_MINUTES})`,
      ip,
    });
  });
  return code;
}

export type OtpCheck =
  | { ok: true }
  | { ok: false; locked: true }
  | { ok: false; locked: false; attemptsLeft: number | null };

export async function checkOtp(
  db: Db,
  secret: string,
  phone: string,
  code: string,
): Promise<OtpCheck> {
  // L'essai est compté avant la comparaison, par une seule instruction : des essais
  // simultanés ne dépassent jamais 5.
  const counted = await db.execute<{ id: string; code_hash: string; attempts: number }>(sql`
    update otp_codes set attempts = attempts + 1
    where id = (
      select id from otp_codes
      where phone_e164 = ${phone} and consumed_at is null and expires_at > now()
      order by created_at desc limit 1
    ) and attempts < ${OTP_MAX_ATTEMPTS}
    returning id, code_hash, attempts`);
  const row = counted.rows[0];
  if (!row) {
    return (await isOtpLocked(db, phone))
      ? { ok: false, locked: true }
      : { ok: false, locked: false, attemptsLeft: null };
  }
  const expected = Buffer.from(row.code_hash, 'hex');
  const given = Buffer.from(otpHash(secret, phone, code), 'hex');
  if (timingSafeEqual(expected, given)) {
    const consumed = await db
      .update(otpCodes)
      .set({ consumedAt: sql`now()` })
      .where(and(eq(otpCodes.id, row.id), isNull(otpCodes.consumedAt)))
      .returning({ id: otpCodes.id });
    if (consumed.length === 1) return { ok: true };
    return { ok: false, locked: false, attemptsLeft: null };
  }
  const attemptsLeft = OTP_MAX_ATTEMPTS - Number(row.attempts);
  return attemptsLeft <= 0
    ? { ok: false, locked: true }
    : { ok: false, locked: false, attemptsLeft };
}
