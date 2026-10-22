import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';

// Composant Banner du système de design : une icône dans une pastille et une phrase.
const variants = {
  error: { icon: 'cross', role: 'alert' },
  success: { icon: 'check', role: 'status' },
  info: { icon: 'info', role: 'status' },
} as const;

export function Banner({ kind, children }: { kind: keyof typeof variants; children: ReactNode }) {
  const { icon, role } = variants[kind];
  return (
    <div className={`banner banner--${kind}`} role={role}>
      <span className={`banner-icon banner-icon--${kind}`}>
        <Icon name={icon} size={16} strokeWidth={3} />
      </span>
      <span>{children}</span>
    </div>
  );
}
