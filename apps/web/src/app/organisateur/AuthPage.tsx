import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';

// Gabarit des écrans d'accès (maquette O1) : logo, titre, puis le contenu en colonne.
export function AuthPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="page page--form stack">
      <Logo />
      <h1 className="title title--flush">{title}</h1>
      {children}
    </main>
  );
}
