import { describe, expect, it } from 'vitest';
import {
  formatDateTime,
  formatMoney,
  formatPercent,
  fromChadInput,
  parseAmount,
  toChadInput,
} from './format';

describe('formats du système de design', () => {
  it('écrit les montants avec une espace insécable', () => {
    expect(formatMoney(20_000)).toBe('20 000 FCFA');
    expect(formatMoney(860)).toBe('860 FCFA');
  });

  it('écrit les dates en toutes lettres, à l’heure du Tchad', () => {
    expect(formatDateTime('2026-11-14T18:00:00.000Z')).toBe('Samedi 14 novembre, 19 h');
    expect(formatDateTime('2026-11-14T18:30:00.000Z')).toBe('Samedi 14 novembre, 19 h 30');
  });

  it('convertit la saisie (heure du Tchad) aller et retour', () => {
    expect(fromChadInput('2026-11-14T19:00')).toBe('2026-11-14T18:00:00.000Z');
    expect(toChadInput('2026-11-14T18:00:00.000Z')).toBe('2026-11-14T19:00');
    expect(fromChadInput('')).toBeNull();
  });

  it('lit un prix saisi avec des espaces', () => {
    expect(parseAmount('20 000')).toBe(20_000);
    expect(parseAmount('abc')).toBeNull();
    expect(formatPercent(400)).toBe('4 %');
  });
});
