import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import {
  assembleTicketQr,
  encodeTicketQrSignedPart,
  type ScanManifest,
  type TicketQrPayload,
} from '@gatio/shared';
import { describe, expect, it } from 'vitest';
import { prepareManifest, verifyTicket } from './verify';

// Même procédé de signature que l'API (module crypto de Node) : on vérifie que la
// page de scan accepte ce que le serveur signe, et rien d'autre.
const { privateKey } = generateKeyPairSync('ed25519');
const publicKey = createPublicKey(privateKey).export({ format: 'jwk' }).x as string;

const EVENT = '00000000-0000-4000-8000-0000000000e1';
const STANDARD = '00000000-0000-4000-8000-0000000000c1';
const ids = {
  valid: '00000000-0000-4000-8000-000000000001',
  used: '00000000-0000-4000-8000-000000000004',
  void: '00000000-0000-4000-8000-000000000005',
  soldAfterDownload: '00000000-0000-4000-8000-000000000099',
};

function qr(ticketId: string, overrides: Partial<TicketQrPayload> = {}, key = privateKey) {
  const signed = encodeTicketQrSignedPart({
    keyId: 1,
    ticketId,
    eventId: EVENT,
    categoryId: STANDARD,
    ...overrides,
  });
  return assembleTicketQr(signed, new Uint8Array(sign(null, signed, key)));
}

const manifest: ScanManifest = {
  eventId: EVENT,
  keys: [{ keyId: 1, publicKey }],
  categories: [{ id: STANDARD, name: 'Standard' }],
  tickets: [
    { id: ids.valid, categoryId: STANDARD, status: 'valid' },
    { id: ids.used, categoryId: STANDARD, status: 'used' },
    { id: ids.void, categoryId: STANDARD, status: 'void' },
  ],
  cursor: '2026-10-22T08:00:00.000Z',
};
const prepared = prepareManifest(manifest);
const none = new Map<string, string>();

describe('vérification locale d’un billet (R25)', () => {
  it('valide un billet de la liste, avec sa catégorie', () => {
    expect(verifyTicket(qr(ids.valid), prepared, none)).toEqual({
      kind: 'valid',
      categoryName: 'Standard',
    });
  });

  it('valide un billet bien signé absent de la liste (vendu après le téléchargement)', () => {
    expect(verifyTicket(qr(ids.soldAfterDownload), prepared, none).kind).toBe('valid');
  });

  it('signale un billet déjà utilisé selon la liste', () => {
    expect(verifyTicket(qr(ids.used), prepared, none)).toEqual({
      kind: 'already_used',
      firstPassageAt: null,
    });
  });

  it('signale un billet déjà passé sur ce téléphone, avec l’heure du premier passage', () => {
    const passages = new Map([[ids.valid, '2026-10-22T19:42:00.000Z']]);
    expect(verifyTicket(qr(ids.valid), prepared, passages)).toEqual({
      kind: 'already_used',
      firstPassageAt: '2026-10-22T19:42:00.000Z',
    });
  });

  it('refuse un billet annulé', () => {
    expect(verifyTicket(qr(ids.void), prepared, none).kind).toBe('void');
  });

  it('refuse un billet d’un autre événement, même bien signé', () => {
    const other = qr(ids.valid, { eventId: '00000000-0000-4000-8000-0000000000e2' });
    expect(verifyTicket(other, prepared, none).kind).toBe('invalid');
  });

  it('refuse un billet signé par une autre clé', () => {
    const forger = generateKeyPairSync('ed25519').privateKey;
    expect(verifyTicket(qr(ids.valid, {}, forger), prepared, none).kind).toBe('invalid');
  });

  it('refuse un billet dont un octet a été modifié', () => {
    const text = qr(ids.valid);
    const tampered = text.slice(0, 10) + (text[10] === 'A' ? 'B' : 'A') + text.slice(11);
    expect(verifyTicket(tampered, prepared, none).kind).toBe('invalid');
  });

  it('refuse un identifiant de clé inconnu', () => {
    expect(verifyTicket(qr(ids.valid, { keyId: 2 }), prepared, none).kind).toBe('invalid');
  });

  it.each(['', 'https://exemple.com', 'GT-7K3M9Q'])('refuse un QR quelconque « %s »', (text) => {
    expect(verifyTicket(text, prepared, none).kind).toBe('invalid');
  });

  it('vérifie vite (moins de 50 ms en moyenne)', () => {
    const text = qr(ids.valid);
    verifyTicket(text, prepared, none);
    const start = performance.now();
    for (let i = 0; i < 20; i++) verifyTicket(text, prepared, none);
    expect((performance.now() - start) / 20).toBeLessThan(50);
  });
});
