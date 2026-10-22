'use client';

import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon } from '@/components/Icon';
import { texts } from '@/texts/fr';

type Frame = { label: string; help?: string | undefined; error?: string | null | undefined };

// Champ du système de design : étiquette au-dessus, aide en dessous, erreur reliée au champ
// (icône « ! » et texte en rouge, maquettes O1 à O4).
function FieldFrame({
  label,
  help,
  error,
  multiline,
  children,
}: Frame & {
  multiline?: boolean;
  children: (props: { id: string; describedBy?: string }) => ReactNode;
}) {
  const id = useId();
  const describedBy = [help && !error && `${id}-help`, error && `${id}-error`]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className={`field-input${multiline ? ' field-input--multiline' : ''}`}>
        {children({ id, ...(describedBy ? { describedBy } : {}) })}
      </div>
      {help && !error && (
        <p className="field-help" id={`${id}-help`}>
          {help}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          <Icon name="alert" size={20} />
          {error}
        </p>
      )}
    </div>
  );
}

export function Field({
  label,
  help,
  error,
  type = 'text',
  ...input
}: Frame & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>) {
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';
  return (
    <FieldFrame label={label} help={help} error={error}>
      {({ id, describedBy }) => (
        <>
          <input
            id={id}
            type={isPassword && visible ? 'text' : type}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            {...input}
          />
          {isPassword && (
            <button type="button" className="field-toggle" onClick={() => setVisible((v) => !v)}>
              {visible ? texts.form.hide : texts.form.show}
            </button>
          )}
        </>
      )}
    </FieldFrame>
  );
}

export function TextAreaField({
  label,
  help,
  error,
  ...textarea
}: Frame & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>) {
  return (
    <FieldFrame label={label} help={help} error={error} multiline>
      {({ id, describedBy }) => (
        <textarea
          id={id}
          rows={4}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...textarea}
        />
      )}
    </FieldFrame>
  );
}

export function SelectField({
  label,
  help,
  error,
  placeholder,
  options,
  ...select
}: Frame & {
  placeholder: string;
  options: ReadonlyArray<{ value: string; label: string }>;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'>) {
  return (
    <FieldFrame label={label} help={help} error={error}>
      {({ id, describedBy }) => (
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...select}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldFrame>
  );
}
