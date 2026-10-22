import { organizerEventDetailSchema, organizerProfileSchema } from '@gatio/shared';
import type { Metadata } from 'next';
import { OrganizerShell } from '@/components/organizer/OrganizerShell';
import { PublicationPanel } from '@/components/organizer/PublicationPanel';
import { getAsOrganizer, segment } from '@/lib/server-api';
import { siteUrl } from '@/lib/site';
import { texts } from '@/texts/fr';

export const metadata: Metadata = { title: `${texts.app.name} · ${texts.space.publication.title}` };
export const dynamic = 'force-dynamic';

// Vue d'un événement côté organisateur (maquette O5 et proposition « report ») :
// publication, lien de vente, ventes, report, annulation.
export default async function EventOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event, profile] = await Promise.all([
    getAsOrganizer(`/organizer/events/${segment(id)}`, organizerEventDetailSchema),
    getAsOrganizer('/organizer/profile', organizerProfileSchema),
  ]);
  return (
    <OrganizerShell title={texts.space.publication.title} backHref="/organisateur" section="events">
      <PublicationPanel
        event={event}
        hasPayoutAccount={profile.payoutAccount !== null}
        saleUrl={`${siteUrl()}/e/${event.slug}`}
      />
    </OrganizerShell>
  );
}
