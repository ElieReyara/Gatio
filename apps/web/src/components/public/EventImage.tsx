import { Icon } from '@/components/Icon';
import { texts } from '@/texts/fr';

// Image d'un événement, ou image par défaut du système de design (aplat sable, billet).
// Sans hauteur donnée, c'est la classe qui la fixe (page d'un événement, selon l'écran).
export function EventImage({
  url,
  height,
  className,
}: {
  url: string | null;
  height?: number;
  className?: string;
}) {
  const style = height === undefined ? undefined : { height };
  const extra = className ? ` ${className}` : '';
  if (url) {
    // Image déjà ré-encodée en WebP (1 200 px) par l'API.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={`event-cover${extra}`} src={url} alt="" style={style} />;
  }
  return (
    <div
      className={`event-cover event-cover--default${extra}`}
      style={style}
      role="img"
      aria-label={texts.public.imageAlt}
    >
      <Icon name="ticket" size={64} strokeWidth={1.6} />
    </div>
  );
}
