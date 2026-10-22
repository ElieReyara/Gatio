import { Icon } from '@/components/Icon';
import { texts } from '@/texts/fr';

// Image d'un événement, ou image par défaut du système de design (aplat sable, billet).
export function EventImage({ url, height }: { url: string | null; height: number }) {
  if (url) {
    // Image déjà ré-encodée en WebP (1 200 px) par l'API.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="event-cover" src={url} alt="" style={{ height }} />;
  }
  return (
    <div
      className="event-cover event-cover--default"
      style={{ height }}
      role="img"
      aria-label={texts.public.imageAlt}
    >
      <Icon name="ticket" size={64} strokeWidth={1.6} />
    </div>
  );
}
