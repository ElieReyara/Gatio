'use client';

import { payoutAccountSchema, payoutMethods, type PayoutMethod } from '@gatio/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Banner } from '@/components/Banner';
import { Field } from '@/components/form/Field';
import { Icon } from '@/components/Icon';
import { sendJson } from '@/lib/api-client';
import { texts } from '@/texts/fr';

const t = texts.space.payout;
type Errors = Partial<Record<'method' | 'number', string>>;

// Moyen de versement (maquette O2, états 2 et 3). Le numéro enregistré n'est jamais
// réaffiché en entier : on le saisit de nouveau pour le changer.
export function PayoutForm({ current }: { current: PayoutMethod | null }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const parsed = payoutAccountSchema.safeParse(
      Object.fromEntries(new FormData(formEvent.currentTarget)),
    );
    if (!parsed.success) {
      const fields = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      setErrors({
        ...(fields.has('method') ? { method: t.methodMissing } : {}),
        ...(fields.has('number') ? { number: t.numberInvalid } : {}),
      });
      return;
    }
    setErrors({});
    setBusy(true);
    const result = await sendJson('PUT', '/organizer/payout-account', parsed.data);
    setBusy(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    router.push('/organisateur/profil');
    router.refresh();
  }

  const errorCount = Object.keys(errors).length;
  return (
    <form className="stack" onSubmit={(formEvent) => void submit(formEvent)} noValidate>
      {errorCount > 1 && <Banner kind="error">{texts.space.fixCount(errorCount)}</Banner>}
      {failed && <Banner kind="error">{texts.form.networkError}</Banner>}
      <p className="lead">{t.lead}</p>
      <fieldset className="stack stack--tight" aria-invalid={errors.method ? true : undefined}>
        <legend className="visually-hidden">{t.title}</legend>
        {payoutMethods.map((method) => (
          <label key={method} className={`option${errors.method ? ' option--error' : ''}`}>
            <input type="radio" name="method" value={method} defaultChecked={current === method} />
            {t.methods[method]}
          </label>
        ))}
        {errors.method && (
          <p className="field-error">
            <Icon name="alert" size={20} />
            {errors.method}
          </p>
        )}
      </fieldset>
      <Field
        label={t.number}
        name="number"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        help={t.numberHelp}
        error={errors.number}
      />
      <button type="submit" className="button-primary" disabled={busy}>
        {busy ? texts.space.saving : t.submit}
      </button>
    </form>
  );
}
