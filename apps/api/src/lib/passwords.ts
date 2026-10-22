import argon2 from 'argon2';

// argon2id aux paramètres minimaux recommandés par l'OWASP (19 Mio, 2 passes) :
// un seul serveur au lancement, des connexions simultanées.
const options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, options);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// Email inconnu : on fait quand même un calcul argon2 pour que la durée de la réponse
// ne révèle pas l'existence du compte.
let dummyHash: Promise<string> | null = null;
export async function spendPasswordCheckTime(password: string): Promise<void> {
  dummyHash ??= hashPassword('gatio-compte-inexistant');
  await verifyPassword(await dummyHash, password);
}
