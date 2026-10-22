import Link from 'next/link';
import type { ReactNode } from 'react';
import { texts } from '@/texts/fr';

// Gabarit des écrans organisateur (maquettes O2 à O5) : barre du haut (avec retour),
// onglets d'un événement, contenu, barre de navigation du bas.
type Section = 'events' | 'payouts' | 'profile';

const sections: Array<{ key: Section; href: string }> = [
  { key: 'events', href: '/organisateur' },
  { key: 'payouts', href: '/organisateur/reversements' },
  { key: 'profile', href: '/organisateur/profil' },
];

export function OrganizerShell({
  title,
  backHref,
  section,
  tabs,
  children,
}: {
  title: string;
  backHref?: string;
  section?: Section;
  tabs?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <header className="shell-top">
        {backHref && (
          <Link className="shell-back" href={backHref} aria-label={texts.space.back}>
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </Link>
        )}
        <span>{title}</span>
      </header>
      {tabs}
      <main className="shell-body stack">{children}</main>
      {section && (
        <nav className="shell-nav">
          {sections.map(({ key, href }) => (
            <Link
              key={key}
              href={href}
              className={key === section ? 'is-active' : undefined}
              aria-current={key === section ? 'page' : undefined}
            >
              {texts.space.nav[key]}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

export function EventTabs({ eventId, active }: { eventId: string; active: 'info' | 'tickets' }) {
  const tabs = [
    { key: 'info' as const, href: `/organisateur/evenements/${eventId}` },
    { key: 'tickets' as const, href: `/organisateur/evenements/${eventId}/billets` },
  ];
  return (
    <nav className="tabs">
      {tabs.map(({ key, href }) => (
        <Link
          key={key}
          href={href}
          className={key === active ? 'is-active' : undefined}
          aria-current={key === active ? 'page' : undefined}
        >
          {texts.space.tabs[key]}
        </Link>
      ))}
    </nav>
  );
}
