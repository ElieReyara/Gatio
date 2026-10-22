import { organizerEventDetailSchema } from '@gatio/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CategoryForm } from '@/components/organizer/CategoryForm';
import { EventTabs, OrganizerShell } from '@/components/organizer/OrganizerShell';
import { getAsOrganizer, segment } from '@/lib/server-api';
import { texts } from '@/texts/fr';

export const metadata: Metadata = {
  title: `${texts.app.name} · ${texts.space.categoryForm.editTitle}`,
};
export const dynamic = 'force-dynamic';

// Modification d'une catégorie : le formulaire O4 rempli (écran complété, journal n° 64).
export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ id: string; categoryId: string }>;
}) {
  const { id, categoryId } = await params;
  const event = await getAsOrganizer(
    `/organizer/events/${segment(id)}`,
    organizerEventDetailSchema,
  );
  const category = event.categories.find(
    (item) => item.id === categoryId && item.archivedAt === null,
  );
  if (!category) notFound();
  return (
    <OrganizerShell
      title={event.title}
      backHref={`/organisateur/evenements/${id}/billets`}
      tabs={<EventTabs eventId={id} active="tickets" />}
    >
      <CategoryForm eventId={id} capacity={event.capacity} category={category} />
    </OrganizerShell>
  );
}
