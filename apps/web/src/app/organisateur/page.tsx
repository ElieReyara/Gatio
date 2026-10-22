import { organizerEventListSchema } from '@gatio/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OrganizerShell } from '@/components/organizer/OrganizerShell';
import { formatDateTime } from '@/lib/format';
import { getAsOrganizer } from '@/lib/server-api';
import { texts } from '@/texts/fr';

const t = texts.space;

export const metadata: Metadata = { title: `${texts.app.name} · ${t.events.title}` };
export const dynamic = 'force-dynamic';

// « Mes événements » : pas de maquette, écran complété avec les cartes et boutons des
// maquettes O4 et O5 (journal de bord n° 64).
export default async function MyEventsPage() {
  const { items } = await getAsOrganizer('/organizer/events', organizerEventListSchema);
  return (
    <OrganizerShell title={t.events.title} section="events">
      <Link className="button-primary button-link" href="/organisateur/evenements/nouveau">
        {t.events.create}
      </Link>
      {items.length === 0 && <p className="lead muted">{t.events.empty}</p>}
      {items.map((event) => (
        <Link
          key={event.id}
          className="card card--link"
          href={`/organisateur/evenements/${event.id}`}
        >
          <span className={`pill${event.status === 'published' ? ' pill--success' : ''}`}>
            {t.events.status[event.status]}
          </span>
          <h2 className="card-title">{event.title}</h2>
          <span>
            <strong>{formatDateTime(event.startsAt)}</strong>
            <br />
            {event.venue}, {event.city}
          </span>
        </Link>
      ))}
    </OrganizerShell>
  );
}
