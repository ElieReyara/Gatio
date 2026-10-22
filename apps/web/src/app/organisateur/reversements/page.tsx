import { organizerProfileSchema } from '@gatio/shared';
import type { Metadata } from 'next';
import { OrganizerShell } from '@/components/organizer/OrganizerShell';
import { getAsOrganizer } from '@/lib/server-api';
import { texts } from '@/texts/fr';

export const metadata: Metadata = { title: `${texts.app.name} · ${texts.space.payouts.title}` };
export const dynamic = 'force-dynamic';

// État vide de la maquette O9 : aucun reversement ne peut exister avant les ventes ;
// la liste réelle arrive en tranche 13.
export default async function PayoutsPage() {
  await getAsOrganizer('/organizer/profile', organizerProfileSchema);
  return (
    <OrganizerShell title={texts.space.payouts.title} section="payouts">
      <p className="lead muted">{texts.space.payouts.empty}</p>
    </OrganizerShell>
  );
}
