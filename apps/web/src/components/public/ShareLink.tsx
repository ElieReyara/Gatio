'use client';

import { useState } from 'react';
import { texts } from '@/texts/fr';

const t = texts.public;

// Partage du lien de l'événement (demande du responsable, 23/10/2026) : WhatsApp d'abord,
// copie du lien pour les autres messageries.
export function ShareLink({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack stack--tight">
      <h2 className="subtitle">{t.shareTitle}</h2>
      <a
        className="button-secondary button-link"
        href={`https://wa.me/?text=${encodeURIComponent(t.shareText(title, url))}`}
        rel="noopener noreferrer"
      >
        {t.share}
      </a>
      <button
        type="button"
        className="button-secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? t.copied : t.copy}
      </button>
    </div>
  );
}
