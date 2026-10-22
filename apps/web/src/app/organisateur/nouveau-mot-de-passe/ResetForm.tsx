'use client';

import { PASSWORD_MIN_LENGTH } from '@gatio/shared';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Banner } from '@/components/Banner';
import { Field } from '@/components/form/Field';
import { postJson } from '@/lib/api-client';
import { texts } from '@/texts/fr';
import { AuthPage } from '../AuthPage';

const t = texts.organizer;
type State = 'loading' | 'form' | 'done' | 'expired';

export function ResetForm() {
  // Le jeton est après le « # » du lien de l'email : jamais envoyé au serveur du site.
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token');
    setToken(value);
    setState(value ? 'form' : 'expired');
    // Retire le jeton de la barre d'adresse et de l'historique.
    history.replaceState(null, '', window.location.pathname);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newPassword = String(new FormData(event.currentTarget).get('newPassword') ?? '');
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(t.passwordTooShort);
      return;
    }
    setError(null);
    setFailure(null);
    setBusy(true);
    const result = await postJson('/auth/password/reset', { token, newPassword });
    setBusy(false);
    if (result.ok) setState('done');
    else if (result.error?.code === 'TOKEN_INVALID') setState('expired');
    else setFailure(result.status === 429 ? texts.form.tooManyAttempts : texts.form.networkError);
  }

  if (state === 'done') {
    return (
      <AuthPage title={t.reset.title}>
        <Banner kind="success">{t.reset.done}</Banner>
        <Link className="button-primary button-link" href="/organisateur/connexion">
          {t.reset.toLogin}
        </Link>
      </AuthPage>
    );
  }

  if (state === 'expired') {
    return (
      <AuthPage title={t.reset.title}>
        <Banner kind="error">{t.reset.expired}</Banner>
        <Link className="button-primary button-link" href="/organisateur/mot-de-passe-oublie">
          {t.reset.newLink}
        </Link>
        <Link className="link" href="/organisateur/connexion">
          {t.forgot.backToLogin}
        </Link>
      </AuthPage>
    );
  }

  return (
    <AuthPage title={t.reset.title}>
      <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
        {failure && <Banner kind="error">{failure}</Banner>}
        <Field
          label={t.reset.password}
          name="newPassword"
          type="password"
          autoComplete="new-password"
          help={t.passwordHelp}
          error={error}
        />
        <button type="submit" className="button-primary" disabled={busy || state !== 'form'}>
          {busy ? t.reset.submitting : t.reset.submit}
        </button>
        <p className="fine-print">{t.reset.signOutNotice}</p>
      </form>
    </AuthPage>
  );
}
