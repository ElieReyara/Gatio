import { organizerEventDetailSchema } from '@gatio/shared';
import type { Metadata } from 'next';
import { CategoryForm } from '@/components/organizer/CategoryForm';
import { EventTabs, OrganizerShell } from '@/components/organizer/OrganizerShell';
import { getAsOrganizer } from '@/lib/server-api';
import { texts } from '@/texts/fr';

export const metadata: Metadata = {
  title: `${texts.app.name} · ${texts.space.categoryForm.newTitle}`,
};
export const dynamic = 'force-dynamic';

export default async function NewCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getAsOrganizer(`/organizer/events/${id}`, organizerEventDetailSchema);
  return (
    <OrganizerShell
      title={event.title}
      backHref={`/organisateur/evenements/${id}/billets`}
      tabs={<EventTabs eventId={id} active="tickets" />}
    >
      <CategoryForm eventId={id} capacity={event.capacity} />
    </OrganizerShell>
  );
}
