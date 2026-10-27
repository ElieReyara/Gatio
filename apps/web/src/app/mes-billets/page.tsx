import type { Metadata } from 'next';
import { MyTickets } from '@/components/public/MyTickets';
import { texts } from '@/texts/fr';

export const metadata: Metadata = {
  title: `${texts.myTickets.title} · ${texts.app.name}`,
  robots: { index: false },
};

// Mes billets (maquette B7) et connexion par code (B6).
export default function MyTicketsPage() {
  return <MyTickets />;
}
