import type { FeePreview } from '@gatio/shared';

// R2 : frais par billet = arrondi au plus proche (0,5 vers le haut) de prix × points / 10 000,
// plus le montant fixe. Entiers seulement, jamais de nombre à virgule (règle 3).
export type PercentFixedParams = { percentBps: number; fixedAmount: number };

export function computeFee(
  price: number,
  params: PercentFixedParams,
  currency: string,
): FeePreview {
  if (!Number.isSafeInteger(price * params.percentBps)) throw new Error('amount out of safe range');
  const percentAmount = Math.floor((price * params.percentBps + 5_000) / 10_000);
  const feeAmount = percentAmount + params.fixedAmount;
  const payoutAmount = price - feeAmount;
  return {
    price,
    percentBps: params.percentBps,
    percentAmount,
    fixedAmount: params.fixedAmount,
    feeAmount,
    payoutAmount,
    currency,
    // R3 : le montant reversé doit être au moins 1.
    priceTooLow: payoutAmount < 1,
  };
}
