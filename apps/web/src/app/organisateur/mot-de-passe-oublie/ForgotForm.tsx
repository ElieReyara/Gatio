'use client';

import { passwordForgotRequestSchema } from '@gatio/shared';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Banner } from '@/components/Banner';
import { Field } from '@/components/form/Field';
import { postJson } from '@/lib/api-client';
import { texts } from '@/texts/fr';
import { AuthPage } from '../AuthPage';

const t = texts.organizer;

export function ForgotForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    const parsed = passwordForgotRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setError(t.emailInvalid);
      return;
    }
    setError(null);
    setFailure(null);
    setBusy(true);
    const result = await postJson('/auth/password/forgot', parsed.data);
    setBusy(false);
    if (result.ok) setSent(true);
    else setFailure(result.status === 429 ? texts.form.tooManyAttempts : texts.form.networkError);
  }

  const backToLogin = (
    <Link className="link" href="/organisateur/connexion">
      {t.forgot.backToLogin}
    </Link>
  );

  if (sent) {
    return (
      <AuthPage title={t.forgot.sentTitle}>
        <Banner kind="success">
          {t.forgot.sentBefore}
          <strong>{t.forgot.sentStrong}</strong>
          {t.forgot.sentAfter}
        </Banner>
        <p className="lead">{t.forgot.notReceived}</p>
        {failure && <Banner kind="error">{failure}</Banner>}
        <button
          type="button"
          className="button-secondary"
          disabled={busy}
          onClick={() => void send()}
        >
          {busy ? t.forgot.submitting : t.forgot.resend}
        </button>
        {backToLogin}
      </AuthPage>
    );
  }

  return (
    <AuthPage title={t.forgot.title}>
      <form
        className="stack"
        noValidate
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void send();
        }}
      >
        <p className="lead">{t.forgot.lead}</p>
        {failure && <Banner kind="error">{failure}</Banner>}
        <Field
          label={t.email}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={error}
        />
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? t.forgot.submitting : t.forgot.submit}
        </button>
        {backToLogin}
      </form>
    </AuthPage>
  );
}
