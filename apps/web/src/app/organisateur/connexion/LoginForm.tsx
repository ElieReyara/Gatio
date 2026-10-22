'use client';

import { loginRequestSchema } from '@gatio/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Banner } from '@/components/Banner';
import { Field } from '@/components/form/Field';
import { postJson } from '@/lib/api-client';
import { texts } from '@/texts/fr';

const t = texts.organizer;

export function LoginForm() {
  const router = useRouter();
  const [failure, setFailure] = useState<'credentials' | 'tooMany' | 'network' | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = loginRequestSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (!parsed.success) {
      setFailure('credentials');
      return;
    }
    setBusy(true);
    const result = await postJson('/auth/login', parsed.data);
    setBusy(false);
    if (result.ok) {
      router.push('/organisateur');
      router.refresh();
    } else {
      setFailure(
        result.status === 401 ? 'credentials' : result.status === 429 ? 'tooMany' : 'network',
      );
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
      {failure === 'credentials' && (
        <Banner kind="error">
          <strong>{t.login.failedStrong}</strong> {t.login.failed}
        </Banner>
      )}
      {failure === 'tooMany' && <Banner kind="error">{texts.form.tooManyAttempts}</Banner>}
      {failure === 'network' && <Banner kind="error">{texts.form.networkError}</Banner>}
      <Field label={t.email} name="email" type="email" autoComplete="email" inputMode="email" />
      <Field label={t.password} name="password" type="password" autoComplete="current-password" />
      <button type="submit" className="button-primary" disabled={busy}>
        {busy ? t.login.submitting : t.login.submit}
      </button>
      <Link className="link" href="/organisateur/mot-de-passe-oublie">
        {t.login.forgot}
      </Link>
      <Link className="link link--tight" href="/organisateur/inscription">
        {t.login.toRegister}
      </Link>
    </form>
  );
}
