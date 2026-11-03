import { entryReportSchema, type EntryReport } from '@gatio/shared';
import type { Metadata } from 'next';
import { Icon } from '@/components/Icon';
import { AutoRefresh } from '@/components/organizer/AutoRefresh';
import { OrganizerShell } from '@/components/organizer/OrganizerShell';
import { formatTime } from '@/lib/format';
import { getAsOrganizer, segment } from '@/lib/server-api';
import { texts } from '@/texts/fr';

const t = texts.space.entryReport;

export const metadata: Metadata = { title: `${texts.app.name} · ${t.title}` };
export const dynamic = 'force-dynamic';

const badges: Record<EntryReport['latest'][number]['outcome'], string> = {
  accepted: 'badge badge--success',
  duplicate: 'badge badge--warning',
  unknown_ticket: 'badge badge--danger',
  void_ticket: 'badge badge--danger',
  wrong_event: 'badge badge--danger',
};

// Rapport d'entrée (maquette O8) : entrées, doublons, téléphones à jour, derniers passages.
// Relu toutes les 15 secondes pendant l'événement.
export default async function EntryReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getAsOrganizer(
    `/organizer/events/${segment(id)}/entry-report`,
    entryReportSchema,
  );
  return (
    <OrganizerShell title={t.title} backHref={`/organisateur/evenements/${id}/controleurs`}>
      <AutoRefresh seconds={15} />
      {report.latest.length === 0 ? (
        <div className="empty">
          <span className="empty-icon">
            <Icon name="ticket" size={36} strokeWidth={1.8} />
          </span>
          <p className="my-ticket-title">{t.emptyTitle}</p>
          <p className="lead">{t.emptyText}</p>
        </div>
      ) : (
        <>
          <div className="entry-stats">
            <div className="card">
              <span className="muted">{t.entered}</span>
              <strong className="display">{t.enteredValue(report.entered, report.sold)}</strong>
            </div>
            <div className="card">
              <span className="muted">{t.duplicates}</span>
              <strong className="display">{report.duplicates}</strong>
            </div>
          </div>
          <div className="card">
            <strong>{t.lists}</strong>
            <span>{t.phones(report.phonesUpToDate)}</span>
          </div>
          <h2 className="subtitle">{t.latest}</h2>
          {report.latest.map((row) => (
            <div key={row.id} className="card">
              <span className="entry-line">
                <strong>
                  {row.categoryName && row.orderReference
                    ? `${row.categoryName} · ${row.orderReference}`
                    : t.unknownTicket}
                </strong>
                <span className={badges[row.outcome]}>{t.outcomes[row.outcome]}</span>
              </span>
              <span className="muted">
                {[
                  formatTime(row.receivedAt),
                  row.scannerName,
                  ...(row.usedAt ? [t.alreadyUsedAt(formatTime(row.usedAt))] : []),
                ].join(' · ')}
              </span>
            </div>
          ))}
        </>
      )}
    </OrganizerShell>
  );
}
