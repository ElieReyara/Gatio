import { createHash, randomBytes } from 'node:crypto';

// Jetons (session, réinitialisation…) : 256 bits aléatoires ; seule leur empreinte
// SHA-256 est stockée (instructions générales, règle 10).
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
