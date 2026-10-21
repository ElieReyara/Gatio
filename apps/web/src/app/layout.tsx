import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { texts } from '@/texts/fr';
import './globals.css';

export const metadata: Metadata = {
  title: texts.app.name,
  description: texts.app.tagline,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#faf6ef',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
