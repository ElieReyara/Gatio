import Link from 'next/link';
import { texts } from '@/texts/fr';

const t = texts.site;

// Pied commun des pages acheteur (pieds des maquettes B1 et B2 réunis, 27/10/2026) : billets,
// support (pré-rempli avec l'événement sur sa page), espace organisateur.
export function PublicFooter({
  eventSlug,
  onMyTickets = false,
}: {
  eventSlug?: string;
  // Sur « Mes billets », pas de lien vers la page elle-même.
  onMyTickets?: boolean;
}) {
  return (
    <footer className="site-footer">
      <nav className="site-footer-inner" aria-label={t.footer}>
        {!onMyTickets && (
          <div className="site-footer-group">
            <Link className="link link--left" href="/mes-billets">
              {texts.public.findTickets}
            </Link>
          </div>
        )}
        <div className="site-footer-group">
          <span className="fine-print fine-print--left">
            {eventSlug ? texts.public.problem : t.question}
          </span>
          <Link
            className="link link--left"
            href={eventSlug ? `/support?evenement=${eventSlug}` : '/support'}
          >
            {texts.public.contactSupport}
          </Link>
        </div>
        <div className="site-footer-group">
          <span className="fine-print fine-print--left">{texts.public.organizerPrompt}</span>
          <Link className="link link--left" href="/organisateur">
            {texts.public.organizerLink}
          </Link>
        </div>
      </nav>
    </footer>
  );
}
