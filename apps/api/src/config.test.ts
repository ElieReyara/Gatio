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
});
