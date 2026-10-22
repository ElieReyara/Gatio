import { organizerProfileSchema } from '@gatio/shared';
import type { Metadata } from 'next';
import { OrganizerShell } from '@/components/organizer/OrganizerShell';
import { getAsOrganizer } from '@/lib/server-api';
import { texts } from '@/texts/fr';
import { LogoutButton } from '../LogoutButton';
import { ProfileForm } from './ProfileForm';

export const metadata: Metadata = { title: `${texts.app.name} · ${texts.space.profile.title}` };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const profile = await getAsOrganizer('/organizer/profile', organizerProfileSchema);
  return (
    <OrganizerShell title={texts.space.profile.title} section="profile">
      <ProfileForm profile={profile} />
      <LogoutButton />
    </OrganizerShell>
  );
}
