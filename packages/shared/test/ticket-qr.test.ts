import { describe, expect, it } from 'vitest';
import {
  assembleTicketQr,
  encodeTicketQrSignedPart,
  fromBase64Url,
  parseTicketQr,
  toBase64Url,
} from '../src/ticket-qr.js';

const payload = {
  keyId: 1,
  ticketId: '0b7c5a52-3f0e-4c8a-9d2e-6f1a2b3c4d5e',
  eventId: '6a1f8e2d-4b3c-4d5e-8f90-a1b2c3d4e5f6',
  categoryId: 'c0ffee00-1234-4abc-8def-0123456789ab',
};
const signature = new Uint8Array(64).fill(7);

describe('format du QR code', () => {
  it('fait 50 octets signés et environ 152 caractères au total', () => {
    const signed = encodeTicketQrSignedPart(payload);
    expect(signed).toHaveLength(50);
    expect(assembleTicketQr(signed, signature)).toHaveLength(152);
  });

  it('relit exactement ce qui a été écrit', () => {
    const text = assembleTicketQr(encodeTicketQrSignedPart(payload), signature);
    const parsed = parseTicketQr(text);
    expect(parsed).toMatchObject({ version: 1, ...payload });
    expect(parsed?.signature).toEqual(signature);
  });

  it('ne contient que des caractères base64url', () => {
    const text = assembleTicketQr(encodeTicketQrSignedPart(payload), signature);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['vide', ''],
    ['texte quelconque', 'https://exemple.com'],
    ['trop court', toBase64Url(new Uint8Array(113))],
    ['mauvaise version', toBase64Url(new Uint8Array(114).fill(2))],
  ])('refuse un contenu %s', (_label, text) => {
    expect(parseTicketQr(text)).toBeNull();
  });

  it('refuse un identifiant de clé hors d’un octet', () => {
    expect(() => encodeTicketQrSignedPart({ ...payload, keyId: 256 })).toThrow();
  });

  it('décode le base64url sans remplissage', () => {
    expect(fromBase64Url(toBase64Url(new Uint8Array([251, 255, 0])))).toEqual(
      new Uint8Array([251, 255, 0]),
    );
  });
});
