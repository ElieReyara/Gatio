import { organizerEventDetailSchema } from '@gatio/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CategoryCard } from '@/components/organizer/CategoryCard';
import { EventTabs, OrganizerShell } from '@/components/organizer/OrganizerShell';
import { getAsOrganizer } from '@/lib/server-api';
import { texts } from '@/texts/fr';

export const metadata: Metadata = { title: texts.app.name };
export const dynamic = 'force-dynamic';

// Onglet « Billets » : liste des catégories (écran complété avec les cartes de O4/O5).
export default async function EventTicketsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getAsOrganizer(`/organizer/events/${id}`, organizerEventDetailSchema);
  const t = texts.space.categories;
  return (
    <OrganizerShell
      title={event.title}
      backHref="/organisateur"
      tabs={<EventTabs eventId={id} active="tickets" />}
    >
      <Link
        className="button-primary button-link"
        href={`/organisateur/evenements/${id}/billets/nouvelle`}
      >
        {t.add}
      </Link>
      {event.categories.length === 0 && <p className="lead muted">{t.empty}</p>}
      {event.categories.map((category) => (
        <CategoryCard
          key={category.id}
          eventId={id}
          eventStartsAt={event.startsAt}
          category={category}
        />
      ))}
    </OrganizerShell>
  );
}
