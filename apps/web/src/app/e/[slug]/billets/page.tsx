import { publicEventSchema } from '@gatio/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { BackHeader } from '@/components/public/BackHeader';
import { Checkout } from '@/components/public/Checkout';
import { FunnelBeacon } from '@/components/public/FunnelBeacon';
import { getPublic } from '@/lib/public-api';
import { texts } from '@/texts/fr';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: `${texts.checkout.title} · ${texts.app.name}`,
  robots: { index: false },
};

// Choix des billets (maquette B3). Sans catégorie en vente, retour à la page de l'événement,
// qui explique pourquoi (annulé, reporté, épuisé, bientôt en vente).
export default async function TicketsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = /^[a-z0-9]{4,32}$/.test(slug)
    ? await getPublic(`/events/${slug}`, publicEventSchema)
    : null;
  if (!event) notFound();
  const onSale =
    event.status === 'published' &&
    event.categories.some((category) => category.availability === 'available');
  if (!onSale) redirect(`/e/${event.slug}`);

  return (
    <>
      <BackHeader title={event.title} backHref={`/e/${event.slug}`} />
      <main className="page page--card page--flush-top">
        <Checkout event={event} phoneVerification={event.phoneVerification} />
      </main>
      <FunnelBeacon type="checkout_started" eventSlug={event.slug} />
    </>
  );
}
