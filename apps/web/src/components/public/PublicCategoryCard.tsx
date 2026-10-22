import type { PublicCategory } from '@gatio/shared';
import { formatMoney, formatOpening } from '@/lib/format';
import { texts } from '@/texts/fr';

const t = texts.public;

// Composant CategoryCard (système de design) : nom, prix payé, état en toutes lettres.
// Le choix des quantités viendra avec la réservation (maquette B3, tranche 5).
export function PublicCategoryCard({
  category,
  stopped,
}: {
  category: PublicCategory;
  stopped: boolean;
}) {
  const state = stopped ? 'stopped' : category.availability;
  const open = state === 'available';
  return (
    <div className={`category${open ? '' : ' category--off'}`}>
      <div>
        <div className="category-name">{category.name}</div>
        <div className="category-price">{formatMoney(category.priceAmount)}</div>
        {state === 'upcoming' && category.saleStartsAt && (
          <div className="category-note">{t.opensOn(formatOpening(category.saleStartsAt))}</div>
        )}
      </div>
      <span className={`tag tag--${state}`}>{t.availability[state]}</span>
    </div>
  );
}
