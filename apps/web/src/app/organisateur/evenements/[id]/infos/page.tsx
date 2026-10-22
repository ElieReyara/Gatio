import { organizerEventDetailSchema } from '@gatio/shared';
import type { Metadata } from 'next';
import { EventForm } from '@/components/organizer/EventForm';
import { EventTabs, OrganizerShell } from '@/components/organizer/OrganizerShell';
import { getAsOrganizer, segment } from '@/lib/server-api';
import { texts } from '@/texts/fr';

export const metadata: Metadata = { title: texts.app.name };
export const dynamic = 'force-dynamic';

// Onglet « Infos » : le formulaire O3 rempli (écran complété, journal de bord n° 64).
export default async function EventInfoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getAsOrganizer(
    `/organizer/events/${segment(id)}`,
    organizerEventDetailSchema,
  );
  return (
    <OrganizerShell
      title={event.title}
      backHref={`/organisateur/evenements/${id}`}
      tabs={<EventTabs eventId={id} active="info" />}
    >
      <EventForm event={event} />
    </OrganizerShell>
  );
}
