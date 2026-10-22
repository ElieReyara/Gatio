import { describe, expect, it } from 'vitest';
import { computeFee } from './compute.js';

const launchRule = { percentBps: 400, fixedAmount: 100 };

describe('calcul des frais (R2, R3)', () => {
  // Tableau du cahier des charges §4.
  it.each([
    [1_000, 140, 860],
    [5_000, 300, 4_700],
    [20_000, 900, 19_100],
    [50_000, 2_100, 47_900],
  ])('billet à %i FCFA : frais %i, l’organisateur reçoit %i', (price, fee, payout) => {
    const result = computeFee(price, launchRule, 'XAF');
    expect(result.feeAmount).toBe(fee);
    expect(result.payoutAmount).toBe(payout);
    expect(result.price).toBe(result.feeAmount + result.payoutAmount);
  });

  it('détaille l’exemple de l’aperçu (maquette O4) : 800 + 100 = 900', () => {
    expect(computeFee(20_000, launchRule, 'XAF')).toMatchObject({
      percentAmount: 800,
      fixedAmount: 100,
      feeAmount: 900,
      payoutAmount: 19_100,
      priceTooLow: false,
    });
  });

  it('arrondit au plus proche, 0,5 vers le haut', () => {
    expect(computeFee(1_012, { percentBps: 400, fixedAmount: 0 }, 'XAF').percentAmount).toBe(40); // 40,48
    expect(computeFee(1_013, { percentBps: 400, fixedAmount: 0 }, 'XAF').percentAmount).toBe(41); // 40,52
    expect(computeFee(1_125, { percentBps: 400, fixedAmount: 0 }, 'XAF').percentAmount).toBe(45); // 45,0
    expect(computeFee(1_000, { percentBps: 450, fixedAmount: 0 }, 'XAF').percentAmount).toBe(45); // 45,0
    expect(computeFee(11, { percentBps: 5_000, fixedAmount: 0 }, 'XAF').percentAmount).toBe(6); // 5,5
  });

  it('signale un prix trop bas quand l’organisateur recevrait moins de 1 FCFA (maquette O4 : 100 → 104)', () => {
    expect(computeFee(100, launchRule, 'XAF')).toMatchObject({ feeAmount: 104, priceTooLow: true });
    expect(computeFee(105, launchRule, 'XAF')).toMatchObject({
      payoutAmount: 1,
      priceTooLow: false,
    });
  });
});
