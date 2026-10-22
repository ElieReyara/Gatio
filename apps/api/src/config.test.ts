import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('configuration', () => {
  it('utilise les valeurs locales par défaut en développement', () => {
    const config = loadConfig({ NODE_ENV: 'development' });
    expect(config.port).toBe(4000);
    expect(config.host).toBe('127.0.0.1');
    expect(config.databaseUrl).toContain('localhost');
  });

  it('refuse de démarrer en production sans variables', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });

  it('exige la clé de signature des QR codes en production', () => {
    const production = {
      NODE_ENV: 'production',
      API_HOST: '0.0.0.0',
      API_PORT: '4000',
      DATABASE_URL: 'postgres://u:p@db:5432/gatio',
      LOG_LEVEL: 'info',
      TICKET_SIGNING_KEY_ID: '1',
    };
    expect(() => loadConfig(production)).toThrow(/TICKET_SIGNING_PRIVATE_KEY/);
    expect(loadConfig({ ...production, TICKET_SIGNING_PRIVATE_KEY: 'k' }).ticketSigning).toEqual({
      keyId: 1,
      privateKey: 'k',
    });
  });

  it('accepte l’absence de clé de signature en développement', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).ticketSigning).toEqual({
      keyId: 1,
      privateKey: undefined,
    });
  });
});
