import { describe, expect, it } from 'vitest';
import {
  categoryCreateSchema,
  normalizeChadPhone,
  payoutAccountSchema,
  profileUpdateSchema,
} from '../src/events.js';

describe('numéros tchadiens (R30)', () => {
  it.each([
    ['66 12 34 56', '+23566123456'],
    ['+235 66 12 34 56', '+23566123456'],
    ['0023566123456', '+23566123456'],
    ['66.12.34.56', '+23566123456'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeChadPhone(input)).toBe(expected);
  });

  it.each(['66 12 34', '+33 6 12 34 56 78', '6612345a', ''])('refuse « %s »', (input) => {
    expect(normalizeChadPhone(input)).toBeNull();
  });
});

describe('formulaires de la tranche 3', () => {
  it('le téléphone de contact est facultatif et normalisé', () => {
    expect(
      profileUpdateSchema.parse({ displayName: 'A', contactPhone: '' }).contactPhone,
    ).toBeNull();
    expect(
      profileUpdateSchema.parse({ displayName: 'A', contactPhone: '66123456' }).contactPhone,
    ).toBe('+23566123456');
    expect(profileUpdateSchema.safeParse({ displayName: 'A', contactPhone: '123' }).success).toBe(
      false,
    );
  });

  it('le moyen de versement exige un numéro tchadien de 8 chiffres (maquette O2)', () => {
    expect(payoutAccountSchema.parse({ method: 'airtel_money', number: '66 12 34 56' })).toEqual({
      method: 'airtel_money',
      number: '+23566123456',
    });
    expect(
      payoutAccountSchema.safeParse({ method: 'airtel_money', number: '66 12 34' }).success,
    ).toBe(false);
  });

  it('une catégorie accepte une période vide (par défaut : jusqu’au début de l’événement)', () => {
    expect(
      categoryCreateSchema.safeParse({ name: 'Standard', priceAmount: 5000, quantityTotal: 200 })
        .success,
    ).toBe(true);
  });
});
