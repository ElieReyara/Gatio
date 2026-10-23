import { describe, expect, it } from 'vitest';
import { orderCreateSchema, phonesMatch } from '../src/orders.js';

const base = {
  eventSlug: 'k7m2x9ab',
  items: [{ categoryId: '0b7c5a52-3f0e-4c8a-9d2e-6f1a2b3c4d5e', quantity: 2 }],
  contact: { name: 'Mahamat Idriss', phone: '66 12 34 56', email: '' },
};

describe('commande (contrat §6.2, R10, R30)', () => {
  it('normalise le numéro et vide l’email absent', () => {
    expect(orderCreateSchema.parse(base).contact).toEqual({
      name: 'Mahamat Idriss',
      phone: '+23566123456',
      email: null,
    });
  });

  it('refuse plus de 10 billets par commande, même répartis', () => {
    const items = [
      { categoryId: '0b7c5a52-3f0e-4c8a-9d2e-6f1a2b3c4d5e', quantity: 6 },
      { categoryId: '1b7c5a52-3f0e-4c8a-9d2e-6f1a2b3c4d5e', quantity: 5 },
    ];
    expect(orderCreateSchema.safeParse({ ...base, items }).success).toBe(false);
  });

  it('refuse un numéro hors +235 et une catégorie en double', () => {
    expect(
      orderCreateSchema.safeParse({
        ...base,
        contact: { ...base.contact, phone: '+33 6 12 34 56 78' },
      }).success,
    ).toBe(false);
    expect(
      orderCreateSchema.safeParse({ ...base, items: [base.items[0], base.items[0]] }).success,
    ).toBe(false);
  });

  it('compare les deux saisies du numéro après normalisation (B3)', () => {
    expect(phonesMatch('66 12 34 56', '+235 66123456')).toBe(true);
    expect(phonesMatch('66 12 34 56', '66 12 34 57')).toBe(false);
    expect(phonesMatch('123', '123')).toBe(false);
  });
});
