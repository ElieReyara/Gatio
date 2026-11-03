import {
  organizerEventDetailSchema,
  scannerInviteListSchema,
  scannerListSchema,
} from '@gatio/shared';
import type { Metadata } from 'next';
import { EventTabs, OrganizerShell } from '@/components/organizer/OrganizerShell';
import { ScannersPanel } from '@/components/organizer/ScannersPanel';
import { getAsOrganizer, segment } from '@/lib/server-api';
import { siteUrl } from '@/lib/site';
import { texts } from '@/texts/fr';

export const metadata: Metadata = { title: `${texts.app.name} · ${texts.space.tabs.scanners}` };
export const dynamic = 'force-dynamic';

// Onglet « Contrôleurs » (maquette O7, état 3) : invitation et liste des contrôleurs.
export default async function EventScannersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event, invites, scanners] = await Promise.all([
    getAsOrganizer(`/organizer/events/${segment(id)}`, organizerEventDetailSchema),
    getAsOrganizer(`/organizer/events/${segment(id)}/scanner-invites`, scannerInviteListSchema),
    getAsOrganizer(`/organizer/events/${segment(id)}/scanners`, scannerListSchema),
  ]);
  return (
    <OrganizerShell
      title={event.title}
      backHref={`/organisateur/evenements/${id}`}
      tabs={<EventTabs eventId={id} active="scanners" />}
    >
      <ScannersPanel
        event={{ id, title: event.title, status: event.status, startsAt: event.startsAt }}
        invites={invites.items}
        scanners={scanners.items}
        siteUrl={await siteUrl()}
      />
    </OrganizerShell>
  );
}
