import { eventStatsSchema, organizerEventDetailSchema } from '@gatio/shared';
import type { Metadata } from 'next';
import { Icon } from '@/components/Icon';
import { AutoRefresh } from '@/components/organizer/AutoRefresh';
import { CopyLinkButton } from '@/components/organizer/CopyLinkButton';
import { EventTabs, OrganizerShell } from '@/components/organizer/OrganizerShell';
import { formatMoney, formatNumber } from '@/lib/format';
import { getAsOrganizer, segment } from '@/lib/server-api';
import { siteUrl } from '@/lib/site';
import { texts } from '@/texts/fr';

const t = texts.space.sales;

export const metadata: Metadata = { title: `${texts.app.name} · ${texts.space.tabs.sales}` };
export const dynamic = 'force-dynamic';

// Onglet « Ventes » (maquette O6) : chiffres de l'événement, relus toutes les 15 secondes,
// et export des acheteurs.
export default async function EventSalesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event, stats] = await Promise.all([
    getAsOrganizer(`/organizer/events/${segment(id)}`, organizerEventDetailSchema),
    getAsOrganizer(`/organizer/events/${segment(id)}/stats`, eventStatsSchema),
  ]);
  const onSale = event.status === 'published';
  const share = stats.total > 0 ? Math.min(100, Math.round((stats.sold / stats.total) * 100)) : 0;
  return (
    <OrganizerShell
      title={event.title}
      backHref={`/organisateur/evenements/${id}`}
      tabs={<EventTabs eventId={id} active="sales" />}
    >
      <AutoRefresh seconds={15} />
      {stats.sold === 0 ? (
        <div className="empty">
          <span className="empty-icon">
            <Icon name="ticket" size={36} strokeWidth={1.8} />
          </span>
          <p className="my-ticket-title">{t.emptyTitle}</p>
          {/* Maquette O6 (état 2) : événement en vente ; sinon, pas de lien à partager. */}
          {onSale && (
            <>
              <p className="lead">{t.emptyText}</p>
              <CopyLinkButton
                url={`${await siteUrl()}/e/${event.slug}`}
                label={t.copyLink}
                copiedLabel={t.copied}
              />
            </>
          )}
        </div>
      ) : (
        <>
          <div className="card">
            <span className="muted">{t.sold}</span>
            <span>
              <strong className="display">{formatNumber(stats.sold)}</strong>{' '}
              <span className="muted">{t.of(formatNumber(stats.total))}</span>
            </span>
            <div className="bar" aria-hidden="true">
              <span style={{ width: `${share}%` }} />
            </div>
          </div>
          <div className="card">
            <span className="muted">{t.paid}</span>
            <strong className="amount">{formatMoney(stats.paidAmount)}</strong>
            <span className="line-row">
              <span>{t.payout}</span>
              <strong>{formatMoney(stats.payoutAmount)}</strong>
            </span>
          </div>
          <div className="card">
            <strong>{t.byCategory}</strong>
            {stats.categories.map((category) => (
              <span key={category.id} className="line-row">
                <span>
                  {category.name}
                  {category.archived && <span className="muted"> · {t.archived}</span>}
                </span>
                <span>
                  {t.categoryLine(
                    category.sold,
                    formatNumber(category.sold),
                    category.remaining,
                    formatNumber(category.remaining),
                  )}
                </span>
              </span>
            ))}
          </div>
          {/* Fichier rendu par l'API (relais du site, cookie de session). Sans « download » :
              une session expirée affiche l'erreur au lieu de l'enregistrer comme fichier. */}
          <a
            className="button-secondary button-link"
            href={`/api/v1/organizer/events/${id}/buyers.csv`}
          >
            {t.export}
          </a>
        </>
      )}
    </OrganizerShell>
  );
}
