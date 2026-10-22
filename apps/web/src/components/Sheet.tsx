'use client';

import { useEffect, useRef, type ReactNode } from 'react';

// Feuille de confirmation du bas (maquette O5 « Annuler cet événement ? ») : titre, phrase,
// action, retour. Échap ou un toucher sur le fond referme sans rien faire.
export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-layer">
      <div className="sheet-shade" onClick={onClose} aria-hidden="true" />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
      >
        <h2 className="title title--flush">{title}</h2>
        {children}
      </div>
    </div>
  );
}
