import { createPublicKey, verify } from 'node:crypto';
import { parseTicketQr } from '@gatio/shared';
import { describe, expect, it } from 'vitest';
import { createTicketSigner, generateSigningKey } from './signing.js';

const ticket = {
  ticketId: '0b7c5a52-3f0e-4c8a-9d2e-6f1a2b3c4d5e',
  eventId: '6a1f8e2d-4b3c-4d5e-8f90-a1b2c3d4e5f6',
  categoryId: 'c0ffee00-1234-4abc-8def-0123456789ab',
};

function verifyWithPublicKey(publicKey: string, signed: Uint8Array, signature: Uint8Array) {
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' });
  return verify(null, signed, key, signature);
}

describe('signature des QR codes', () => {
  const signer = createTicketSigner(1, generateSigningKey());

  it('produit un QR lisible dont la signature se vérifie avec la clé publique', () => {
    const parsed = parseTicketQr(signer.signTicket(ticket));
    expect(parsed).toMatchObject({ keyId: 1, ...ticket });
    expect(verifyWithPublicKey(signer.publicKey, parsed!.signed, parsed!.signature)).toBe(true);
  });

  it('refuse un QR modifié (autre billet, même signature)', () => {
    const parsed = parseTicketQr(signer.signTicket(ticket))!;
    parsed.signed[5] = parsed.signed[5]! ^ 1;
    expect(verifyWithPublicKey(signer.publicKey, parsed.signed, parsed.signature)).toBe(false);
  });

  it('refuse une signature faite avec une autre clé', () => {
    const other = createTicketSigner(1, generateSigningKey());
    const parsed = parseTicketQr(other.signTicket(ticket))!;
    expect(verifyWithPublicKey(signer.publicKey, parsed.signed, parsed.signature)).toBe(false);
  });

  it('refuse une clé qui n’est pas Ed25519', () => {
    expect(() => createTicketSigner(1, Buffer.from('pas une clé').toString('base64'))).toThrow();
  });
});
