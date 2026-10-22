import { organizerProfileSchema } from '@gatio/shared';
import type { Metadata } from 'next';
import { EventForm } from '@/components/organizer/EventForm';
import { OrganizerShell } from '@/components/organizer/OrganizerShell';
import { getAsOrganizer } from '@/lib/server-api';
import { texts } from '@/texts/fr';

export const metadata: Metadata = {
  title: `${texts.app.name} · ${texts.space.eventForm.newTitle}`,
};
export const dynamic = 'force-dynamic';

export default async function NewEventPage() {
  // Vérifie la session avant d'afficher le formulaire.
  await getAsOrganizer('/organizer/profile', organizerProfileSchema);
  return (
    <OrganizerShell title={texts.space.eventForm.newTitle} backHref="/organisateur">
      <EventForm />
    </OrganizerShell>
  );
}
