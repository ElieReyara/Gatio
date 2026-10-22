'use client';

import type { Category } from '@gatio/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Banner } from '@/components/Banner';
import { Sheet } from '@/components/Sheet';
import { sendJson } from '@/lib/api-client';
import { formatDateTime, formatMoney } from '@/lib/format';
import { texts } from '@/texts/fr';

const t = texts.space.categories;

export function salePeriodText(category: Pick<Category, 'saleStartsAt' | 'saleEndsAt'>): string {
  const { saleStartsAt, saleEndsAt } = category;
  if (saleStartsAt && saleEndsAt)
    return t.period(formatDateTime(saleStartsAt), formatDateTime(saleEndsAt));
  if (saleStartsAt) return t.from(formatDateTime(saleStartsAt));
  if (saleEndsAt) return t.until(formatDateTime(saleEndsAt));
  return t.untilStart;
}

// Carte d'une catégorie côté organisateur : nom, prix, ce qu'il reçoit, quantité, période.
export function CategoryCard({
  eventId,
  category,
}: {
  eventId: string;
  eventStartsAt: string;
  category: Category;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const archived = category.archivedAt !== null;

  async function archive() {
    const result = await sendJson('DELETE', `/organizer/categories/${category.id}`);
    setConfirming(false);
    if (result.ok) router.refresh();
    else setFailed(true);
  }

  return (
    <div className="card">
      {archived && <span className="pill">{t.archived}</span>}
      <h2 className="card-title">{category.name}</h2>
      <span className="preview-strong">{formatMoney(category.priceAmount)}</span>
      <span>{t.youReceive(formatMoney(category.fee.payoutAmount))}</span>
      <span className="muted">
        {t.tickets(category.quantityTotal)} · {salePeriodText(category)}
      </span>
      {failed && <Banner kind="error">{texts.form.networkError}</Banner>}
      {!archived && (
        <div className="row">
          <Link
            className="button-secondary button-link"
            href={`/organisateur/evenements/${eventId}/billets/${category.id}`}
          >
            {t.edit}
          </Link>
          <button type="button" className="button-secondary" onClick={() => setConfirming(true)}>
            {t.archive}
          </button>
        </div>
      )}
      {confirming && (
        <Sheet title={t.archiveTitle} onClose={() => setConfirming(false)}>
          <p>{t.archiveText}</p>
          <button type="button" className="button-primary" onClick={() => void archive()}>
            {t.archiveConfirm}
          </button>
          <button type="button" className="button-secondary" onClick={() => setConfirming(false)}>
            {t.archiveCancel}
          </button>
        </Sheet>
      )}
    </div>
  );
}
