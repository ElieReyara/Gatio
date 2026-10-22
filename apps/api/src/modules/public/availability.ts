import type { CategoryAvailability } from '@gatio/shared';

// R12 : état d'une catégorie pour l'acheteur. La fin de vente par défaut est le début de
// l'événement ; « épuisée » quand plus aucun billet n'est libre (vendus + réservés).
export type AvailabilityInput = {
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
};

export function effectiveSaleEnd(category: { saleEndsAt: Date | null }, eventStartsAt: Date): Date {
  return category.saleEndsAt ?? eventStartsAt;
}

export function categoryAvailability(
  category: AvailabilityInput,
  eventStartsAt: Date,
  now: Date = new Date(),
): CategoryAvailability {
  if (now.getTime() >= effectiveSaleEnd(category, eventStartsAt).getTime()) return 'ended';
  if (category.saleStartsAt && now.getTime() < category.saleStartsAt.getTime()) return 'upcoming';
  if (category.quantityTotal - category.quantitySold - category.quantityReserved <= 0)
    return 'sold_out';
  return 'available';
}
