import Link from 'next/link';
import { texts } from '@/texts/fr';

// En-tête des maquettes B3 et B4 : flèche de retour et titre en couleur de marque.
export function BackHeader({ title, backHref }: { title: string; backHref?: string }) {
  return (
    <header className="shell-top public-back">
      {backHref && (
        <Link className="shell-back" href={backHref} aria-label={texts.space.back}>
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
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
  );
}
