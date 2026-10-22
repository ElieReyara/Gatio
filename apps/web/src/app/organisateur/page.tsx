import { organizerProfileSchema } from '@gatio/shared';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { apiUrl } from '@/lib/api';
import { texts } from '@/texts/fr';
import { LogoutButton } from './LogoutButton';

export const metadata: Metadata = { title: texts.app.name };
export const dynamic = 'force-dynamic';

// Page provisoire après connexion : « Mes événements » (sans maquette) arrive en tranche 3.
export default async function OrganizerHomePage() {
  const session = (await cookies()).get('gatio_session')?.value;
  if (!session) redirect('/organisateur/connexion');
  const response = await fetch(`${apiUrl()}/api/v1/organizer/profile`, {
    headers: { cookie: `gatio_session=${session}` },
    cache: 'no-store',
  });
  if (response.status === 401) redirect('/organisateur/connexion');
  const profile = organizerProfileSchema.parse(await response.json());

  return (
    <main className="page page--form stack">
      <Logo />
      <p className="lead">{texts.organizer.home.connectedAs(profile.displayName)}</p>
      <LogoutButton />
    </main>
  );
}
