import { publicEventSchema } from '@gatio/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { Banner } from '@/components/Banner';
import { Icon } from '@/components/Icon';
import { EventImage } from '@/components/public/EventImage';
import { PublicCategoryCard } from '@/components/public/PublicCategoryCard';
import { PublicHeader } from '@/components/public/PublicHeader';
import { formatDateTime } from '@/lib/format';
import { getPublic } from '@/lib/public-api';
import { siteUrl } from '@/lib/site';
import { texts } from '@/texts/fr';

const t = texts.public;
export const dynamic = 'force-dynamic';

const loadEvent = cache(async (slug: string) =>
  /^[a-z0-9]{4,32}$/.test(slug) ? getPublic(`/events/${slug}`, publicEventSchema) : null,
);

// Aperçu de partage (WhatsApp, Facebook) : titre, description et image lus dans le HTML
// rendu par le serveur (conception §3.1).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const event = await loadEvent((await params).slug);
  if (!event) return { title: texts.app.name };
  const description = event.description.slice(0, 160);
  const site = await siteUrl();
  const image = event.imageUrl ? `${site}${event.imageUrl}` : undefined;
  return {
    title: `${event.title} · ${texts.app.name}`,
    description,
    openGraph: {
      title: event.title,
      description,
      url: `${site}/e/${event.slug}`,
      siteName: texts.app.name,
      locale: 'fr_FR',
      type: 'website',
      ...(image ? { images: [{ url: image }] } : {}),
    },
  };
}

// Page d'un événement (maquette B2, états normal, annulé, reporté).
export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const event = await loadEvent((await params).slug);
  if (!event) notFound();
  const cancelled = event.status === 'cancelled';
  const postponed = event.status === 'postponed';
  const stopped = cancelled || postponed;

  return (
    <>
      <PublicHeader />
      {cancelled && (
        <div className="status-banner status-banner--cancelled" role="status">
          <Icon name="cross" />
          <span>
            <strong>{t.cancelledStrong}</strong> {t.cancelledText}
          </span>
        </div>
      )}
      {postponed && (
        <div className="status-banner status-banner--postponed" role="status">
          <Icon name="alert" />
          <span>
            <strong>{t.postponedStrong}</strong> {t.postponedText}
          </span>
        </div>
      )}
      <EventImage url={event.imageUrl} height={180} />
      <main className="page stack page--flush-top event-page">
        <h1 className="display">{event.title}</h1>
        <p className="lead">
          <strong>{postponed ? t.dateTbc : formatDateTime(event.startsAt)}</strong>
          <br />
          {event.venue}, {event.city}
          {!stopped && (
            <>
              <br />
              <span className="muted">{t.organizedBy(event.organizerName)}</span>
            </>
          )}
        </p>
        {!stopped && <Banner kind="info">{t.checkReal}</Banner>}
        {!stopped && <p className="lead description">{event.description}</p>}
        <h2 className="subtitle">{t.tickets}</h2>
        <div className="stack stack--tight">
          {event.categories.map((category) => (
            <PublicCategoryCard key={category.id} category={category} stopped={stopped} />
          ))}
        </div>
        {stopped && (
          <>
            <button type="button" className="button-primary" disabled>
              {t.salesStopped}
            </button>
            <p className="fine-print fine-print--left">
              {cancelled ? t.cancelledHint : t.postponedHint}
            </p>
          </>
        )}
      </main>
      <footer className="public-footer">
        <span className="fine-print fine-print--left">{t.problem}</span>
        <Link className="link link--tight" href={`/support?evenement=${event.slug}`}>
          {t.contactSupport}
        </Link>
      </footer>
    </>
  );
}
