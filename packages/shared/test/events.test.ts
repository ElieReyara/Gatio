import { describe, expect, it } from 'vitest';
import {
  categoryCreateSchema,
  eventUpdateSchema,
  isPrintableOnTicket,
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

describe('texte imprimé sur le billet (journal de bord n° 74)', () => {
  it.each([
    'Soirée Sahel Live – Édition 2026',
    '« Nuit du Chari » : 15 € — l’œuvre complète…',
    'Carré VIP n° 1 (accès coulisses) ™',
  ])('accepte « %s »', (text) => {
    expect(isPrintableOnTicket(text)).toBe(true);
  });

  it.each(['حفل موسيقي', 'Concert 🎉', '音乐会', 'Ǹdjamena'])('refuse « %s »', (text) => {
    expect(isPrintableOnTicket(text)).toBe(false);
  });

  it('titre, lieu et catégorie sont contrôlés, avec un motif reconnaissable', () => {
    const update = eventUpdateSchema.safeParse({ title: 'حفل', venue: 'Salle 🎉' });
    expect(update.success).toBe(false);
    expect(update.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
      ['title', 'unsupported_characters'],
      ['venue', 'unsupported_characters'],
    ]);
    const category = categoryCreateSchema.safeParse({
      name: 'VIP 🎉',
      priceAmount: 5000,
      quantityTotal: 10,
    });
    expect(category.error?.issues[0]?.message).toBe('unsupported_characters');
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
