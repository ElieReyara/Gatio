import { createPublicKey, verify } from 'node:crypto';
import { parseTicketQr, prototypeSampleSchema, scanManifestSchema } from '@gatio/shared';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { testDependencies } from '../../test-support.js';
import { createTicketSigner, generateSigningKey } from '../tickets/signing.js';

const pool = { query: async () => ({}) } as unknown as pg.Pool;
const ticketSigner = createTicketSigner(1, generateSigningKey());

async function app(nodeEnv: 'test' | 'production' = 'test') {
  const dependencies = testDependencies(pool, { ticketSigner });
  return buildApp({ ...dependencies, config: { ...dependencies.config, nodeEnv } });
}

function signatureIsValid(qr: string, publicKey: string) {
  const parsed = parseTicketQr(qr);
  if (!parsed) return false;
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' });
  return verify(null, parsed.signed, key, parsed.signature);
}

describe('prototype de scan (tranche 1)', () => {
  it('livre une liste fictive avec la clé publique', async () => {
    const response = await (await app()).inject({ url: '/api/v1/dev/scan-prototype/manifest' });
    const manifest = scanManifestSchema.parse(response.json());
    expect(manifest.keys).toEqual([{ keyId: 1, publicKey: ticketSigner.publicKey }]);
    expect(manifest.tickets.map((ticket) => ticket.status).sort()).toEqual([
      'used',
      'valid',
      'valid',
      'valid',
      'void',
    ]);
  });

  it('fournit des billets d’essai : seul le contrefait a une signature fausse', async () => {
    const response = await (await app()).inject({ url: '/api/v1/dev/scan-prototype/samples' });
    const { items } = response.json() as { items: unknown[] };
    const samples = items.map((item) => prototypeSampleSchema.parse(item));
    expect(samples).toHaveLength(7);
    for (const sample of samples) {
      const forged = sample.label.includes('contrefait');
      expect(signatureIsValid(sample.qr, ticketSigner.publicKey)).toBe(!forged);
    }
  });

  it('crée un billet absent de la liste déjà téléchargée', async () => {
    const instance = await app();
    const before = scanManifestSchema.parse(
      (await instance.inject({ url: '/api/v1/dev/scan-prototype/manifest' })).json(),
    );
    const created = await instance.inject({
      method: 'POST',
      url: '/api/v1/dev/scan-prototype/tickets',
    });
    expect(created.statusCode).toBe(201);
    const ticketId = parseTicketQr(prototypeSampleSchema.parse(created.json()).qr)?.ticketId;
    expect(before.tickets.some((ticket) => ticket.id === ticketId)).toBe(false);
  });

  it('n’existe pas en production', async () => {
    const response = await (
      await app('production')
    ).inject({
      url: '/api/v1/dev/scan-prototype/manifest',
    });
    expect(response.statusCode).toBe(404);
  });
});
