import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import { texts } from '@/texts/fr';

// Gabarit des écrans d'accès (maquette O1) : logo, titre, puis le contenu en colonne.
export function AuthPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="page page--form page--card stack">
      {/* Le logo ramène au site public (circulation, 27/10/2026). */}
      <Link href="/" className="public-home" aria-label={texts.site.home}>
        <Logo />
      </Link>
      <h1 className="title title--flush">{title}</h1>
      {children}
    </main>
  );
}
