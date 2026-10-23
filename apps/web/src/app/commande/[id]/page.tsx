import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OrderView } from '@/components/public/OrderView';
import { texts } from '@/texts/fr';

export const metadata: Metadata = {
  title: `${texts.order.title} · ${texts.app.name}`,
  robots: { index: false },
};

// Page de la commande. Le jeton est gardé par le navigateur : la lecture se fait côté client.
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  return <OrderView orderId={id} />;
}
