'use client';

import { useState } from 'react';

// Bouton « Copier le lien » (maquettes O5 et O6) : le texte change une fois le lien copié.
export function CopyLinkButton({
  url,
  label,
  copiedLabel,
}: {
  url: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
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
      {/* Le changement de texte est annoncé aux lecteurs d'écran. */}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  );
}
