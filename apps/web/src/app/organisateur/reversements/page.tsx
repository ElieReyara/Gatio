import { payoutsOverviewSchema, type PayoutsOverview } from '@gatio/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Banner } from '@/components/Banner';
import { Icon, type IconName } from '@/components/Icon';
import { OrganizerShell } from '@/components/organizer/OrganizerShell';
import { formatDayMonth, formatMoney } from '@/lib/format';
import { getAsOrganizer } from '@/lib/server-api';
import { texts } from '@/texts/fr';

const t = texts.space.payouts;

export const metadata: Metadata = { title: `${texts.app.name} · ${t.title}` };
export const dynamic = 'force-dynamic';

type Group = PayoutsOverview['groups'][number];

// Badges de la maquette O9 : une icône avec chaque mot.
const badges: Record<Group['status'], { className: string; icon: IconName }> = {
  pending: { className: 'badge badge--neutral', icon: 'clock' },
  sent: { className: 'badge badge--success', icon: 'check' },
  held: { className: 'badge badge--warning', icon: 'alert' },
  failed: { className: 'badge badge--danger', icon: 'cross' },
};

function detail(group: Group): string | null {
  if (group.status === 'sent' && group.date) return t.detail.sent(formatDayMonth(group.date));
  if (group.status === 'failed' && group.date) return t.detail.failed(formatDayMonth(group.date));
  if (group.status === 'held') return t.detail.held;
  // En attente : envoi à la prochaine minute (R21), pas de date prévue (écart E4 du PC-00).
  return null;
}

// Reversements (maquette O9) : un versement part à chaque vente (R21) ; la liste les regroupe
// par événement et par statut.
export default async function PayoutsPage() {
  const overview = await getAsOrganizer('/organizer/payouts', payoutsOverviewSchema);
  const methods = texts.space.payout.methods;
  return (
    <OrganizerShell title={t.title} section="payouts">
      {overview.hasFailed && (
        <Banner kind="error">
          <strong>{t.failedStrong}</strong> {t.failedText}
        </Banner>
      )}
      {overview.groups.length === 0 ? (
        <p className="lead">{t.empty}</p>
      ) : (
        <>
          {overview.pendingAmount > 0 && (
            <div className="card">
              <span className="muted">{t.next}</span>
              <strong className="amount">{formatMoney(overview.pendingAmount)}</strong>
              {overview.pendingTo && (
                <small className="muted">
                  {t.to(methods[overview.pendingTo.method], overview.pendingTo.maskedNumber)}
                </small>
              )}
            </div>
          )}
          <div>
            {overview.groups.map((group) => {
              const badge = badges[group.status];
              return (
                <div key={`${group.eventId}-${group.status}`} className="cell">
                  <span className="line-row">
                    <strong>{group.title}</strong>
                    <strong className="nowrap">{formatMoney(group.amount)}</strong>
                  </span>
                  <span className="line-row">
                    <small>{detail(group)}</small>
                    <span className={badge.className}>
                      <Icon name={badge.icon} size={14} strokeWidth={3} />
                      {t.status[group.status]}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
      {overview.hasFailed && (
        <Link className="button-secondary button-link" href="/organisateur/profil/versement">
          {t.editAccount}
        </Link>
      )}
    </OrganizerShell>
  );
}
