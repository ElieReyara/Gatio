import type { Metadata, Viewport } from 'next';
import { ScanScreen } from '@/scan/ScanScreen';
import { texts } from '@/texts/fr';

export const metadata: Metadata = {
  title: `${texts.app.name} · ${texts.scan.title}`,
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#1f1a14', // jeton ink de tokens.json
};

export default function ScanPage() {
  return <ScanScreen />;
}
