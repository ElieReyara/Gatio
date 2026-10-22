'use client';

import { profileUpdateSchema, type OrganizerProfile } from '@gatio/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Banner } from '@/components/Banner';
import { Field, TextAreaField } from '@/components/form/Field';
import { sendJson } from '@/lib/api-client';
import { texts } from '@/texts/fr';

const t = texts.space.profile;
type Errors = Partial<Record<'displayName' | 'contactPhone', string>>;

// Profil de l'organisateur (maquette O2, états 1 et 4).
export function ProfileForm({ profile }: { profile: OrganizerProfile }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Errors>({});
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const parsed = profileUpdateSchema.safeParse(
      Object.fromEntries(new FormData(formEvent.currentTarget)),
    );
    if (!parsed.success) {
      const fields = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      setErrors({
        ...(fields.has('displayName') ? { displayName: texts.organizer.displayNameMissing } : {}),
        ...(fields.has('contactPhone') ? { contactPhone: t.phoneInvalid } : {}),
      });
      return;
    }
    setErrors({});
    setState('saving');
    const result = await sendJson('PUT', '/organizer/profile', parsed.data);
    setState(result.ok ? 'saved' : 'failed');
    if (result.ok) router.refresh();
  }

  const payout = profile.payoutAccount;
  return (
    <form className="stack" onSubmit={(formEvent) => void submit(formEvent)} noValidate>
      {state === 'saved' && (
        <Banner kind="success">
          <strong>{texts.space.saved}</strong>
          {payout ? ` ${t.savedHint}` : ''}
        </Banner>
      )}
      {state === 'failed' && <Banner kind="error">{texts.form.networkError}</Banner>}
      {!payout && (
        <Banner kind="info">
          <strong>{t.payoutMissingStrong}</strong> {t.payoutMissing}
        </Banner>
      )}
      {payout && (
        <div className="card">
          <strong>{t.payoutCard}</strong>
          <span>
            {texts.space.payout.methods[payout.method]} · {payout.maskedNumber}
          </span>
          <Link className="link link--left" href="/organisateur/profil/versement">
            {t.payoutEdit}
          </Link>
        </div>
      )}
      <Field
        label={texts.organizer.displayName}
        name="displayName"
        defaultValue={profile.displayName}
        help={texts.organizer.displayNameHelp}
        error={errors.displayName}
      />
      <TextAreaField
        label={t.description}
        name="description"
        defaultValue={profile.description ?? ''}
      />
      <Field
        label={t.phone}
        name="contactPhone"
        type="tel"
        inputMode="tel"
        defaultValue={profile.contactPhone ?? ''}
        help={t.phoneHelp}
        error={errors.contactPhone}
      />
      <button type="submit" className="button-primary" disabled={state === 'saving'}>
        {state === 'saving' ? texts.space.saving : t.submit}
      </button>
      {!payout && (
        <Link className="button-secondary button-link" href="/organisateur/profil/versement">
          {t.payoutAdd}
        </Link>
      )}
    </form>
  );
}
