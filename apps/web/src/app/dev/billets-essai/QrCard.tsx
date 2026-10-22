import type { PrototypeSample } from '@gatio/shared';
import { texts } from '@/texts/fr';

const t = texts.prototype;

export function QrCard({ sample, svg }: { sample: PrototypeSample; svg: string }) {
  return (
    <figure className="qr-card">
      {/* SVG produit par la bibliothèque qrcode à partir de données signées : aucun texte saisi. */}
      <div className="qr-image" dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption>
        <strong>{sample.label}</strong>
        <br />
        {t.expected} : {t.expectedLabels[sample.expected]}
      </figcaption>
    </figure>
  );
}
