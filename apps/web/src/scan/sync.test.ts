import { generateKeyPairSync, sign } from 'node:crypto';
import {
  assembleTicketQr,
  encodeTicketQrSignedPart,
  SCAN_PASSAGES_PER_BATCH,
  type ScanManifest,
} from '@gatio/shared';
import { describe, expect, it } from 'vitest';
import type { LocalPassage } from './storage';
import {
  applyResults,
  earliest,
  firstValidPassages,
  mergeTickets,
  nextBatch,
  otherEvents,
} from './sync';
import { prepareManifest } from './verify';

const EVENT = '00000000-0000-4000-8000-0000000000e1';
const OTHER = '00000000-0000-4000-8000-0000000000e2';
const STANDARD = '00000000-0000-4000-8000-0000000000c1';
const VIP = '00000000-0000-4000-8000-0000000000c2';
const TICKET = '00000000-0000-4000-8000-000000000001';
const SOLD_LATER = '00000000-0000-4000-8000-000000000099';
const { privateKey } = generateKeyPairSync('ed25519');

function qr(ticketId: string, categoryId = STANDARD) {
  const signed = encodeTicketQrSignedPart({ keyId: 1, ticketId, eventId: EVENT, categoryId });
  return assembleTicketQr(signed, new Uint8Array(sign(null, signed, privateKey)));
}

let counter = 0;
function passage(overrides: Partial<LocalPassage> = {}): LocalPassage {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    eventId: EVENT,
    ticketId: TICKET,
    scannedAt: `2026-11-03T19:${String(counter % 60).padStart(2, '0')}:00.000Z`,
    localResult: 'valid',
    verifyMs: 3,
    qr: qr(TICKET),
    ...overrides,
  };
}

const manifest = (): ReturnType<typeof prepareManifest> => {
  const value: ScanManifest = {
    eventId: EVENT,
    keys: [],
    categories: [{ id: STANDARD, name: 'Standard' }],
    tickets: [{ id: TICKET, categoryId: STANDARD, status: 'valid', usedAt: null }],
    cursor: '2026-11-03T18:00:00.000Z',
  };
  return prepareManifest(value);
};

describe('file des passages du téléphone (R26)', () => {
  it('envoie dans l’ordre des scans, seulement l’événement en cours, par lots', () => {
    const late = passage({ scannedAt: '2026-11-03T20:00:00.000Z' });
    const early = passage({ scannedAt: '2026-11-03T19:00:00.000Z' });
    const foreign = passage({ eventId: OTHER });
    const { batch, invalid } = nextBatch([late, foreign, early], EVENT);
    expect(batch.map((item) => item.id)).toEqual([early.id, late.id]);
    expect(invalid).toEqual([]);
    expect(otherEvents([late, foreign, early], EVENT)).toEqual([foreign.id]);

    const many = Array.from({ length: SCAN_PASSAGES_PER_BATCH + 5 }, () => passage());
    expect(nextBatch(many, EVENT).batch).toHaveLength(SCAN_PASSAGES_PER_BATCH);
  });

  it('écarte un passage mal formé au lieu de bloquer la file', () => {
    const broken = passage({ scannedAt: 'hier' });
    const fine = passage();
    const { batch, invalid } = nextBatch([broken, fine], EVENT);
    expect(batch.map((item) => item.id)).toEqual([fine.id]);
    expect(invalid).toEqual([broken.id]);
  });

  it('garde le premier passage « valide » de chaque billet', () => {
    const first = passage({ scannedAt: '2026-11-03T19:00:00.000Z' });
    const second = passage({ scannedAt: '2026-11-03T19:05:00.000Z' });
    const refused = passage({ localResult: 'invalid', ticketId: null, qr: null });
    expect(firstValidPassages([second, refused, first])).toEqual(
      new Map([[TICKET, '2026-11-03T19:00:00.000Z']]),
    );
  });
});

describe('liste locale (R26, R27)', () => {
  it('un billet accepté ou en doublon devient « utilisé » avant de quitter la file', () => {
    const prepared = manifest();
    const accepted = passage();
    const soldLater = passage({ ticketId: SOLD_LATER, qr: qr(SOLD_LATER, VIP) });
    const unknown = passage({ ticketId: null, qr: null, localResult: 'invalid' });
    const changed = applyResults(
      prepared,
      [accepted, soldLater, unknown],
      [
        { id: accepted.id, outcome: 'accepted', usedAt: '2026-11-03T19:01:00.000Z' },
        { id: soldLater.id, outcome: 'duplicate', usedAt: '2026-11-03T18:59:00.000Z' },
        { id: unknown.id, outcome: 'unknown_ticket', usedAt: null },
      ],
    );
    expect(changed).toBe(true);
    expect(prepared.tickets.get(TICKET)).toEqual({
      id: TICKET,
      categoryId: STANDARD,
      status: 'used',
      usedAt: '2026-11-03T19:01:00.000Z',
    });
    // Billet vendu après la liste : catégorie lue dans son QR.
    expect(prepared.tickets.get(SOLD_LATER)).toMatchObject({ categoryId: VIP, status: 'used' });
    expect(prepared.tickets.size).toBe(2);
  });

  it('un refus du serveur ne change rien à la liste', () => {
    const prepared = manifest();
    const voided = passage();
    expect(
      applyResults(prepared, [voided], [{ id: voided.id, outcome: 'void_ticket', usedAt: null }]),
    ).toBe(false);
    expect(prepared.tickets.get(TICKET)?.status).toBe('valid');
  });

  it('les changements reçus remplacent les billets sans effet double', () => {
    const prepared = manifest();
    const used = {
      id: TICKET,
      categoryId: STANDARD,
      status: 'used' as const,
      usedAt: '2026-11-03T19:00:00.000Z',
    };
    expect(mergeTickets(prepared, [used, used])).toBe(true);
    expect(prepared.tickets.get(TICKET)).toEqual(used);
    expect(mergeTickets(prepared, [])).toBe(false);
  });

  it('heure du premier passage : la plus ancienne', () => {
    expect(earliest('2026-11-03T19:05:00.000Z', '2026-11-03T19:01:00.000Z')).toBe(
      '2026-11-03T19:01:00.000Z',
    );
    expect(earliest(null, '2026-11-03T19:01:00.000Z')).toBe('2026-11-03T19:01:00.000Z');
    expect(earliest(null, null)).toBeNull();
  });
});
