import { describe, expect, it } from 'vitest';
import { maskPersonalData, maskPhone } from './redact.js';

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

  it('ne touche pas une référence de commande ni un identifiant court', () => {
    expect(maskPersonalData('/support/orders?reference=GT-7K3M9Q')).toBe(
      '/support/orders?reference=GT-7K3M9Q',
    );
  });
});
