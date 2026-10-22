'use client';

import { prototypeSampleSchema, type PrototypeSample } from '@gatio/shared';
import QRCode from 'qrcode';
import { useState } from 'react';
import { texts } from '@/texts/fr';
import { QrCard } from './QrCard';

const t = texts.prototype;

export function CreateTicket() {
  const [created, setCreated] = useState<Array<{ sample: PrototypeSample; svg: string }>>([]);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const response = await fetch('/api/v1/dev/scan-prototype/tickets', { method: 'POST' });
      const sample = prototypeSampleSchema.parse(await response.json());
      const svg = await QRCode.toString(sample.qr, { type: 'svg', margin: 4 });
      setCreated((list) => [...list, { sample, svg }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {created.map(({ sample, svg }) => (
        <QrCard key={sample.qr} sample={sample} svg={svg} />
      ))}
      <div className="qr-card">
        <button
          type="button"
          className="button-primary"
          disabled={busy}
          onClick={() => void create()}
        >
          {busy ? t.creating : t.createAfterDownload}
        </button>
      </div>
    </>
  );
}
