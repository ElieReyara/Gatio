import type { Metadata } from 'next';
import { JoinScreen } from '@/scan/JoinScreen';
import { texts } from '@/texts/fr';

export const metadata: Metadata = {
  title: `${texts.app.name} · ${texts.scan.title}`,
  robots: { index: false },
  // Ajoutée à l'écran d'accueil (conseil de C1), la page ouvre le scan, pas ce lien.
  manifest: '/manifest.webmanifest',
};

// Lien d'invitation d'un contrôleur (maquette C1) : /c#jeton.
export default function JoinPage() {
  return <JoinScreen />;
}
