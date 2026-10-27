'use client';

import { useId } from 'react';
import { texts } from '@/texts/fr';

const t = texts.buyerLogin;

// Code à 6 chiffres (maquette B6) : un seul champ, pour coller le code ou le reprendre du
// SMS (proposition du clavier du téléphone), affiché en six cases.
export function CodeInput({
  value,
  onChange,
  error,
  describedBy,
  busy,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  error: boolean;
  describedBy?: string | undefined;
  busy: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label className="code-label" htmlFor={id}>
        {t.code}
      </label>
      <div className={`code${error ? ' code--error' : ''}`}>
        {Array.from({ length: 6 }, (_, index) => (
          <span
            key={index}
            className={`code-box${index === Math.min(value.length, 5) ? ' is-current' : ''}`}
            aria-hidden="true"
          >
            {value[index] ?? ''}
          </span>
        ))}
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={value}
          // Lecture seule (pas « désactivé ») pendant la vérification : le champ garde le
          // focus et le clavier, pour corriger un code faux tout de suite.
          readOnly={busy}
          autoFocus={autoFocus}
          aria-invalid={error || undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        />
      </div>
    </div>
  );
}
