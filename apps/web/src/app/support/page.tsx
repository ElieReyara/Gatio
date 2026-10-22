import { publicEventSchema } from '@gatio/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Banner } from '@/components/Banner';
import { Icon } from '@/components/Icon';
import { PublicHeader } from '@/components/public/PublicHeader';
import { getPublic } from '@/lib/public-api';
import { siteUrl, supportContacts } from '@/lib/site';
import { texts } from '@/texts/fr';

const t = texts.support;

export const metadata: Metadata = { title: `${texts.app.name} · ${t.title}` };
export const dynamic = 'force-dynamic';

// Page de support (R35 adapté : plusieurs moyens de contact, journal de bord n° 66).
// Le message est pré-rempli avec le nom et le lien de l'événement ; aucun formulaire,
// aucune donnée enregistrée : le support répond dans sa messagerie.
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ evenement?: string }>;
}) {
  const { evenement } = await searchParams;
  const event =
    evenement && /^[a-z0-9]{4,32}$/.test(evenement)
      ? await getPublic(`/events/${evenement}`, publicEventSchema)
      : null;
  const { whatsapp, email } = supportContacts();
  const eventUrl = event ? `${siteUrl()}/e/${event.slug}` : null;
  const message = event && eventUrl ? t.message(event.title, eventUrl) : '';

  return (
    <>
      <PublicHeader />
      <main className="page stack page--flush-top">
        <h1 className="title title--flush">{t.title}</h1>
        <p className="lead">{event ? t.aboutEvent(event.title) : t.general}</p>
        {whatsapp && (
          <a
            className="contact-option"
            href={`https://wa.me/${whatsapp}${message ? `?text=${encodeURIComponent(message)}` : ''}`}
            rel="noopener noreferrer"
          >
            <Icon name="phone" />
            <span>
              {t.whatsapp}
              <small>+{whatsapp}</small>
            </span>
          </a>
        )}
        {email && (
          <a
            className="contact-option"
            href={`mailto:${email}${event ? `?subject=${encodeURIComponent(t.subject(event.title))}&body=${encodeURIComponent(message)}` : ''}`}
          >
            <Icon name="info" />
            <span>
              {t.email}
              <small>{email}</small>
            </span>
          </a>
        )}
        {!whatsapp && !email && <p className="lead muted">{t.notConfigured}</p>}
        {event && <Banner kind="info">{t.refundHint}</Banner>}
        <Link className="link" href={event ? `/e/${event.slug}` : '/'}>
          {event ? t.backToEvent : t.toEvents}
        </Link>
      </main>
    </>
  );
}
