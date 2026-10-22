import { organizerProfileSchema } from '@gatio/shared';
import type { Metadata } from 'next';
import { OrganizerShell } from '@/components/organizer/OrganizerShell';
import { getAsOrganizer } from '@/lib/server-api';
import { texts } from '@/texts/fr';
import { PayoutForm } from './PayoutForm';

export const metadata: Metadata = { title: `${texts.app.name} · ${texts.space.payout.title}` };
export const dynamic = 'force-dynamic';

export default async function PayoutPage() {
  const profile = await getAsOrganizer('/organizer/profile', organizerProfileSchema);
  return (
    <OrganizerShell title={texts.space.payout.title} backHref="/organisateur/profil">
      <PayoutForm current={profile.payoutAccount?.method ?? null} />
    </OrganizerShell>
  );
}
