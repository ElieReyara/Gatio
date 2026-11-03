import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import {
  assembleTicketQr,
  encodeTicketQrSignedPart,
  parseTicketQr,
  type TicketQrPayload,
} from '@gatio/shared';

// Signature Ed25519 des QR codes (conception §3.6) : la clé privée ne quitte jamais
// le serveur ; la clé publique est livrée avec la liste du scan.
export type TicketSigner = {
  keyId: number;
  publicKey: string;
  signTicket(ticket: Omit<TicketQrPayload, 'keyId'>): string;
  // QR authentique (signé par cette clé) : son contenu ; sinon null.
  verifyTicket(qr: string): Omit<TicketQrPayload, 'keyId'> | null;
};

export function createTicketSigner(keyId: number, privateKeyPkcs8Base64: string): TicketSigner {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyPkcs8Base64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  if (privateKey.asymmetricKeyType !== 'ed25519')
    throw new Error('ticket signing key must be Ed25519');
  const publicKey = createPublicKey(privateKey);
  return {
    keyId,
    publicKey: rawPublicKey(privateKey),
    signTicket(ticket) {
      const signed = encodeTicketQrSignedPart({ ...ticket, keyId });
      return assembleTicketQr(signed, new Uint8Array(sign(null, signed, privateKey)));
    },
    verifyTicket(qr) {
      const parsed = parseTicketQr(qr);
      if (!parsed || parsed.keyId !== keyId) return null;
      if (!verify(null, parsed.signed, publicKey, parsed.signature)) return null;
      return { ticketId: parsed.ticketId, eventId: parsed.eventId, categoryId: parsed.categoryId };
    },
  };
}

export function generateSigningKey(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
}

// Clé publique brute (32 octets) en base64url, format attendu par la page de scan.
function rawPublicKey(privateKey: KeyObject): string {
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
  if (!jwk.x) throw new Error('cannot export Ed25519 public key');
  return jwk.x;
}
