import Link from 'next/link';
import { Logo } from '@/components/Logo';

// En-tête des pages acheteur (maquettes B1 et B2) : le logo ramène à la liste.
export function PublicHeader() {
  return (
    <header className="public-header">
      <Link href="/" className="public-home">
        <Logo />
      </Link>
    </header>
  );
}
