import { fromBase64Url, parseTicketQr, type ScanManifest } from '@gatio/shared';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

// Vérification par bibliothèque JavaScript, pas par l'API du navigateur, inégale
// selon les versions (conception §3.7).
ed.hashes.sha512 = sha512;

export type ScanOutcome =
  | { kind: 'valid'; categoryName: string }
  | { kind: 'already_used'; firstPassageAt: string | null }
  | { kind: 'void' }
  | { kind: 'invalid' };

export type PreparedManifest = {
  eventId: string;
  keys: Map<number, Uint8Array>;
  tickets: Map<string, ScanManifest['tickets'][number]>;
  categories: Map<string, string>;
};

export function prepareManifest(manifest: ScanManifest): PreparedManifest {
  const keys = new Map<number, Uint8Array>();
  for (const key of manifest.keys) {
    const bytes = fromBase64Url(key.publicKey);
    if (bytes?.length === 32) keys.set(key.keyId, bytes);
  }
  return {
    eventId: manifest.eventId,
    keys,
    tickets: new Map(manifest.tickets.map((ticket) => [ticket.id, ticket])),
    categories: new Map(manifest.categories.map((category) => [category.id, category.name])),
  };
}

/**
 * Règle R25 : signature valide et bon événement, puis recherche dans la liste locale.
 * Un billet bien signé absent de la liste est accepté (vendu après le téléchargement).
 * `localPassages` : premier passage accepté par ce téléphone, par billet.
 */
export function verifyTicket(
  qrText: string,
  manifest: PreparedManifest,
  localPassages: ReadonlyMap<string, string>,
): ScanOutcome {
  const parsed = parseTicketQr(qrText);
  if (!parsed) return { kind: 'invalid' };
  const publicKey = manifest.keys.get(parsed.keyId);
  if (!publicKey || !signatureIsValid(parsed.signature, parsed.signed, publicKey)) {
    return { kind: 'invalid' };
  }
  if (parsed.eventId !== manifest.eventId) return { kind: 'invalid' };

  const ticket = manifest.tickets.get(parsed.ticketId);
  if (ticket?.status === 'void') return { kind: 'void' };
  const firstPassageAt = localPassages.get(parsed.ticketId) ?? null;
  if (ticket?.status === 'used' || firstPassageAt) return { kind: 'already_used', firstPassageAt };
  return { kind: 'valid', categoryName: manifest.categories.get(parsed.categoryId) ?? '' };
}

function signatureIsValid(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) {
  try {
    return ed.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}
