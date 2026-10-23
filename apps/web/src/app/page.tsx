import { cities, eventTypes, publicEventListSchema } from '@gatio/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Banner } from '@/components/Banner';
import { Icon } from '@/components/Icon';
import { EventImage } from '@/components/public/EventImage';
import { PublicHeader } from '@/components/public/PublicHeader';
import { formatDateTime, formatMoney } from '@/lib/format';
import { getPublic } from '@/lib/public-api';
import { texts } from '@/texts/fr';

const t = texts.public;

export const metadata: Metadata = { title: `${texts.app.name} · ${t.listTitle}` };
export const dynamic = 'force-dynamic';

type Search = { ville?: string; quand?: string; type?: string; apres?: string };

// Liste et recherche des événements (maquette B1) : ville, date, type. Formulaire sans
// JavaScript (méthode GET) : la page reste légère et fonctionne sur tout téléphone.
export default async function EventListPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const city = cities.find((value) => value === search.ville);
  const type = eventTypes.find((value) => value === search.type);
  const thisWeek = search.quand === 'semaine';
  const query = new URLSearchParams();
  if (city) query.set('city', city);
  if (type) query.set('type', type);
  if (thisWeek) query.set('to', new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString());
  if (search.apres && /^[A-Za-z0-9_-]{1,200}$/.test(search.apres))
    query.set('cursor', search.apres);
  // API indisponible : la page s'affiche quand même, avec un message.
  const result = await getPublic(`/events?${query}`, publicEventListSchema).catch(() => undefined);
  const items = result?.items ?? [];

  const typeHref = (value?: string) => {
    const params = new URLSearchParams();
    if (city) params.set('ville', city);
    if (thisWeek) params.set('quand', 'semaine');
    if (value) params.set('type', value);
    const text = params.toString();
    return text ? `/?${text}` : '/';
  };
  const moreHref = () => {
    const params = new URLSearchParams();
    if (city) params.set('ville', city);
    if (thisWeek) params.set('quand', 'semaine');
    if (type) params.set('type', type);
    if (result?.nextCursor) params.set('apres', result.nextCursor);
    return `/?${params}`;
  };

  return (
    <>
      <PublicHeader />
      <main className="page stack page--flush-top">
        <h1 className="title title--flush">{t.listTitle}</h1>
        <form className="filters" method="get" action="/">
          <select name="ville" defaultValue={city ?? ''} aria-label={texts.space.eventForm.city}>
            <option value="">{t.allCities}</option>
            {cities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            name="quand"
            defaultValue={thisWeek ? 'semaine' : ''}
            aria-label={texts.space.eventForm.startsAt}
          >
            <option value="">{t.allDates}</option>
            <option value="semaine">{t.thisWeek}</option>
          </select>
          {type && <input type="hidden" name="type" value={type} />}
          <button type="submit" className="button-secondary button-auto">
            {t.filter}
          </button>
        </form>
        <nav className="chips" aria-label={texts.space.eventForm.type}>
          <Link className={`chip${type ? '' : ' is-active'}`} href={typeHref()}>
            {t.allTypes}
          </Link>
          {eventTypes.map((value) => (
            <Link
              key={value}
              className={`chip${type === value ? ' is-active' : ''}`}
              href={typeHref(value)}
            >
              {texts.space.eventTypes[value]}
            </Link>
          ))}
        </nav>
        {result === undefined && <Banner kind="error">{t.unavailable}</Banner>}
        {result !== undefined && items.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">
              <Icon name="ticket" size={40} />
            </span>
            <strong className="card-title">{t.emptyTitle}</strong>
            <span>{t.emptyText}</span>
            <Link className="button-secondary button-link" href="/">
              {t.clearFilters}
            </Link>
          </div>
        ) : (
          items.map((event) => (
            <Link key={event.slug} className="event-card" href={`/e/${event.slug}`}>
              <EventImage url={event.imageUrl} height={140} />
              <span className="event-card-text">
                <span className="event-card-title">{event.title}</span>
                <span>{formatDateTime(event.startsAt)}</span>
                <span className="muted">
                  {event.venue}, {event.city}
                </span>
                {event.minPriceAmount !== null && (
                  <strong>{t.from(formatMoney(event.minPriceAmount))}</strong>
                )}
              </span>
            </Link>
          ))
        )}
        {result?.nextCursor && (
          <Link className="button-secondary button-link" href={moreHref()}>
            {t.more}
          </Link>
        )}
      </main>
      <footer className="public-footer">
        <span className="fine-print fine-print--left">{t.organizerPrompt}</span>
        <Link className="link link--tight" href="/organisateur">
          {t.organizerLink}
        </Link>
      </footer>
    </>
  );
}
