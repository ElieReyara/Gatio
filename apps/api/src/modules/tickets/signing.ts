import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto';
import { assembleTicketQr, encodeTicketQrSignedPart, type TicketQrPayload } from '@gatio/shared';

// Signature Ed25519 des QR codes (conception §3.6) : la clé privée ne quitte jamais
// le serveur ; la clé publique est livrée avec la liste du scan.
export type TicketSigner = {
  keyId: number;
  publicKey: string;
  signTicket(ticket: Omit<TicketQrPayload, 'keyId'>): string;
};

export function createTicketSigner(keyId: number, privateKeyPkcs8Base64: string): TicketSigner {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyPkcs8Base64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  if (privateKey.asymmetricKeyType !== 'ed25519')
    throw new Error('ticket signing key must be Ed25519');
  return {
    keyId,
    publicKey: rawPublicKey(privateKey),
    signTicket(ticket) {
      const signed = encodeTicketQrSignedPart({ ...ticket, keyId });
      return assembleTicketQr(signed, new Uint8Array(sign(null, signed, privateKey)));
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
