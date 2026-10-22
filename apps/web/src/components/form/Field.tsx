'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';
import { Icon } from '@/components/Icon';
import { texts } from '@/texts/fr';

type FieldProps = {
  label: string;
  help?: string;
  error?: string | null;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>;

// Champ du système de design : étiquette au-dessus, aide en dessous, erreur reliée au champ.
export function Field({ label, help, error, type = 'text', ...input }: FieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';
  const describedBy = [help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="field-input">
        <input
          id={id}
          type={isPassword && visible ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          {...input}
        />
        {isPassword && (
          <button type="button" className="field-toggle" onClick={() => setVisible((v) => !v)}>
            {visible ? texts.form.hide : texts.form.show}
          </button>
        )}
      </div>
      {help && !error && (
        <p className="field-help" id={`${id}-help`}>
          {help}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          <Icon name="cross" size={20} />
          {error}
        </p>
      )}
    </div>
  );
}
