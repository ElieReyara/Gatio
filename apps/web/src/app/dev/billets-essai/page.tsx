import { prototypeSamplesResponseSchema } from '@gatio/shared';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { apiUrl } from '@/lib/api';
import { texts } from '@/texts/fr';
import { CreateTicket } from './CreateTicket';
import { QrCard } from './QrCard';

// Outil interne du prototype (tranche 1) : affiche à l'écran les billets fictifs à scanner.
export const dynamic = 'force-dynamic';

const t = texts.prototype;

export default async function TestTicketsPage() {
  let response: Response;
  try {
    response = await fetch(`${apiUrl()}/api/v1/dev/scan-prototype/samples`, { cache: 'no-store' });
  } catch {
    return <p className="page">{t.unavailable}</p>;
  }
  // Les routes de prototype n'existent pas en production.
  if (response.status === 404) notFound();
  const { items } = prototypeSamplesResponseSchema.parse(await response.json());
  const cards = await Promise.all(
    items.map(async (sample) => ({
      sample,
      svg: await QRCode.toString(sample.qr, { type: 'svg', margin: 4 }),
    })),
  );
  const { version, modules } = QRCode.create(items[0]?.qr ?? '');

  return (
    <main className="page page--wide">
      <h1 className="title">{t.title}</h1>
      <p>{t.intro}</p>
      <p>{t.density(modules.size, version)}</p>
      <div className="qr-grid">
        {cards.map(({ sample, svg }) => (
          <QrCard key={sample.label} sample={sample} svg={svg} />
        ))}
        <CreateTicket />
      </div>
    </main>
  );
}
