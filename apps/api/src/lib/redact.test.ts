import { describe, expect, it } from 'vitest';
import { maskPersonalData, maskPhone, serializeError } from './redact.js';

describe('masquage des données personnelles dans les journaux', () => {
  it('masque un numéro de téléphone', () => {
    expect(maskPhone('+23566123456')).toBe('+235••••56');
  });

  it('masque téléphone et email dans une adresse, même encodés', () => {
    const masked = maskPersonalData('/support/orders?phone=%2B23566123456&email=nom%40exemple.com');
    expect(masked).not.toContain('66123456');
    expect(masked).not.toContain('nom@exemple.com');
    expect(masked).toContain('+235••••56');
  });

  it('masque un numéro saisi avec des espaces', () => {
    expect(maskPersonalData('numéro 66 12 34 56')).not.toContain('34 56');
  });

  it('laisse intacts une référence, un UUID et une date', () => {
    const text =
      '/api/v1/orders/123e4567-e89b-12d3-a716-446655440000?reference=GT-7K3M9Q&from=2026-10-21';
    expect(maskPersonalData(text)).toBe(text);
  });

  it("ne recopie pas le détail d'une erreur PostgreSQL et masque le message", () => {
    const error = Object.assign(new Error('échec pour nom@exemple.com'), {
      code: '23505',
      detail: 'Key (email)=(nom@exemple.com) already exists.',
    });
    const serialized = JSON.stringify(serializeError(error));
    expect(serialized).not.toContain('nom@exemple.com');
    expect(serialized).toContain('23505');
  });
});
