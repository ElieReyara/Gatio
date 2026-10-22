import { describe, expect, it } from 'vitest';
import { categoryAvailability } from './availability.js';

const event = new Date('2026-11-14T18:00:00Z');
const base = {
  quantityTotal: 100,
  quantitySold: 0,
  quantityReserved: 0,
  saleStartsAt: null,
  saleEndsAt: null,
};
const at = (iso: string) => new Date(iso);

describe('état d’une catégorie (R12, maquette B2)', () => {
  it('disponible par défaut jusqu’au début de l’événement', () => {
    expect(categoryAvailability(base, event, at('2026-11-14T17:59:00Z'))).toBe('available');
    expect(categoryAvailability(base, event, at('2026-11-14T18:00:00Z'))).toBe('ended');
  });

  it('bientôt en vente avant son début (catégorie « jour J »)', () => {
    const dayOf = {
      ...base,
      saleStartsAt: at('2026-11-14T07:00:00Z'),
      saleEndsAt: at('2026-11-14T22:00:00Z'),
    };
    expect(categoryAvailability(dayOf, event, at('2026-11-13T12:00:00Z'))).toBe('upcoming');
    expect(categoryAvailability(dayOf, event, at('2026-11-14T19:00:00Z'))).toBe('available');
    expect(categoryAvailability(dayOf, event, at('2026-11-14T22:00:00Z'))).toBe('ended');
  });

  it('épuisée quand vendus et réservés atteignent la quantité', () => {
    const full = { ...base, quantitySold: 90, quantityReserved: 10 };
    expect(categoryAvailability(full, event, at('2026-11-01T00:00:00Z'))).toBe('sold_out');
    expect(
      categoryAvailability({ ...full, quantityReserved: 9 }, event, at('2026-11-01T00:00:00Z')),
    ).toBe('available');
  });
});
