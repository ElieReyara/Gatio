import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { texts } from '@/texts/fr';

const t = texts.site;
type Current = 'events' | 'tickets';

// En-tête commun des pages acheteur (maquettes B1 et B2, complété le 27/10/2026 à la demande
// du responsable) : le logo ramène à la liste, « Mes billets » reste toujours à portée ; sur
// ordinateur, la liste et l'espace organisateur s'ajoutent.
export function PublicHeader({ current }: { current?: Current }) {
  const here = (page: Current) => (current === page ? ('page' as const) : undefined);
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="public-home" aria-label={t.home}>
          <Logo />
        </Link>
        <nav className="site-nav" aria-label={t.nav}>
          <Link className="site-nav-wide" href="/" aria-current={here('events')}>
            {t.events}
          </Link>
          <Link href="/mes-billets" aria-current={here('tickets')}>
            <Icon name="ticket" size={20} />
            {t.myTickets}
          </Link>
          <Link className="site-nav-wide" href="/organisateur">
            {t.organizer}
          </Link>
        </nav>
      </div>
    </header>
  );
}
