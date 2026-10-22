'use client';

import { registerRequestSchema } from '@gatio/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Banner } from '@/components/Banner';
import { Field } from '@/components/form/Field';
import { postJson } from '@/lib/api-client';
import { texts } from '@/texts/fr';

const t = texts.organizer;
type Errors = Partial<Record<'email' | 'password' | 'displayName', string>>;

export function RegisterForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = registerRequestSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      const fields = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      setErrors({
        email: fields.has('email') ? t.emailInvalid : undefined,
        password: fields.has('password') ? t.passwordTooShort : undefined,
        displayName: fields.has('displayName') ? t.displayNameMissing : undefined,
      });
      return;
    }
    setErrors({});
    setFailure(null);
    setBusy(true);
    const result = await postJson('/auth/register', parsed.data);
    setBusy(false);
    if (result.ok) {
      router.push('/organisateur');
      router.refresh();
    } else if (result.error?.details.reason === 'already_registered') {
      setErrors({ email: t.register.alreadyRegistered });
    } else {
      setFailure(result.status === 429 ? texts.form.tooManyAttempts : texts.form.networkError);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
      <p className="lead">{t.register.lead}</p>
      {failure && <Banner kind="error">{failure}</Banner>}
      <Field
        label={t.displayName}
        name="displayName"
        autoComplete="organization"
        help={t.displayNameHelp}
        error={errors.displayName}
      />
      <Field
        label={t.email}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        help={t.emailHelp}
        error={errors.email}
      />
      <Field
        label={t.password}
        name="password"
        type="password"
        autoComplete="new-password"
        help={t.passwordHelp}
        error={errors.password}
      />
      <button type="submit" className="button-primary" disabled={busy}>
        {busy ? t.register.submitting : t.register.submit}
      </button>
      <p className="fine-print">{t.register.terms}</p>
      <Link className="link" href="/organisateur/connexion">
        {t.register.toLogin}
      </Link>
    </form>
  );
}
