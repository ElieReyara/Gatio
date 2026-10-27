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
      WEB_URL: 'https://gatio.example',
      ALLOWED_ORIGINS: 'https://gatio.example',
      MAILPIT_URL: 'http://mailpit:8025',
      EMAIL_FROM: 'noreply@gatio.example',
      STORAGE_DIR: '/var/lib/gatio/media',
      OTP_SECRET: 'x'.repeat(32),
    };
    expect(() => loadConfig(production)).toThrow(/TICKET_SIGNING_PRIVATE_KEY/);
    expect(loadConfig({ ...production, TICKET_SIGNING_PRIVATE_KEY: 'k' }).ticketSigning).toEqual({
      keyId: 1,
      privateKey: 'k',
    });
  });

  it('vérification du numéro active par défaut, passerelle SMS absente sans adresse', () => {
    const config = loadConfig({ NODE_ENV: 'development' });
    expect(config.buyers.phoneVerification).toBe(true);
    expect(config.smsGateway).toBeNull();
    expect(
      loadConfig({ NODE_ENV: 'development', BUYER_PHONE_VERIFICATION: 'off' }).buyers,
    ).toMatchObject({ phoneVerification: false });
  });

  it('accepte l’absence de clé de signature en développement', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).ticketSigning).toEqual({
      keyId: 1,
      privateKey: undefined,
    });
  });
});
